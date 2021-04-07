const fetch = require("node-fetch");

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const JIRA_AUTH = process.env.JIRA_AUTH;

const GITLAB_URL = process.env.GITLAB_URL;
const JIRA_URL = process.env.JIRA_URL;

const GITLAB_BRANCH_NAME = process.env.GITLAB_BRANCH_NAME;
const JIRA_RELEASE_NAME = process.env.JIRA_RELEASE_NAME;
const JIRA_FIELD_NAME = process.env.JIRA_FIELD_NAME;
const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID;
const JIRA_PROJECT_ID = process.env.JIRA_PROJECT_ID;
const JIRA_STATUS = process.env.JIRA_STATUS;

const ALLOW_EMPTY_JIRA_FIELD = process.env.ALLOW_EMPTY_JIRA_FIELD === "true";

const TICKET_URL_MATCH = `https:\\/\\/collaboration\\.msi\\.audi\\.com\\/jira\\/browse\\/(${JIRA_PROJECT_ID}-\\d+)`;

run().catch(console.log);
setInterval(() => run().catch(console.log), 1000 * 60);

async function run() {
	console.log("getting merge requests");
	const gitlabMRs = await getGitlabMRs();
	console.log("getting jira tickets");
	const ids = getJiraIds(gitlabMRs);
	const jiraTickets = await getJiraTickets(ids);
	const filteredMRs = filterMRs(jiraTickets, gitlabMRs);
	for (let mrEntry of filteredMRs) {
		console.log("loading merge request:", mrEntry.iid);
		if (await commitsMatchDescription(mrEntry) !== true) {
			console.log("commits dont match description");
			continue;
		}
		if (mrEntry.merge_status === "cannot_be_merged") {
			console.log("cannot be merged");
			continue;
		}
		const mr = await getMR(mrEntry.iid);
		if (!mr.pipeline) {
			console.log("no pipeline");
			continue;
		}
		if (mr.pipeline.status === "failed") {
			console.log("failed, continue with next pipeline");
			continue;
		}
		if (await isApproved(mr) !== true) {
			console.log("is not approved");
			continue;
		}
		if (needsRebase(mr)) {
			console.log("rebasing");
			await rebaseMR(mr);
			break;
		}
		if (mr.pipeline.status === "running") {
			console.log("pipeline running");
			break;
		}
		if (mr.pipeline.status === "success") {
			console.log("merging pipeline");
			await mergeMR(mr);
			console.log("success, continue with next pipeline");
			continue;
		}
	}
	console.log("done");
}

async function getGitlabMRs() {
	const response = await fetch(buildMRsUrl());
	return await response.json();
}

function buildMRsUrl() {
	return `${GITLAB_URL}/projects/${GITLAB_PROJECT_ID}/merge_requests`
		+ `?private_token=${GITLAB_TOKEN}`
		+ `&scope=all`
		+ `&state=opened`
		+ `&wip=no`
		+ `&target_branch=${GITLAB_BRANCH_NAME}`
		+ `&order_by=created_at`
		+ `&per_page=1000`
		+ `&sort=asc`;
}

async function getJiraTickets(ids) {
	const FIELD_FILTER = `(${ALLOW_EMPTY_JIRA_FIELD ? `'${JIRA_FIELD_NAME}' is EMPTY OR ` : ''} '${JIRA_FIELD_NAME}'='${JIRA_RELEASE_NAME}')`;
	const STATUS_FILTER = JIRA_STATUS ? `status in (${JIRA_STATUS})` : 'status is not EMPTY';
	const ID_FILTER = `id in (${ids.join(",")})`;
	const response = await fetch(buildJiraUrl(), {
		method: "POST",
		headers: {
			"Authorization": `Basic ${JIRA_AUTH}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			jql: `project='${JIRA_PROJECT_ID}' AND ${STATUS_FILTER} ${JIRA_FIELD_NAME ? `AND ${FIELD_FILTER}` : ""} AND ${ID_FILTER}`,
			startAt: 0,
			maxResults: 10000,
			fields: [
				"summary",
				"versions",
				"fixVersions",
				"status",
			],
		}),
	});
	const data = await response.json();
	return data.issues;
}

function buildJiraUrl() {
	return `${JIRA_URL}/search`;
}

function getJiraIds(mrs) {
	return [].concat(...mrs
		.map(mr => mr.description.match(new RegExp(TICKET_URL_MATCH, "g")))
		.filter(mr => !!mr)
		.map(mr => mr.map(url => url.replace(new RegExp(TICKET_URL_MATCH), "$1"))));
}

function filterMRs(jiraTickets, mrs) {
	return mrs.filter(mr => {
		const match = mr.description.match(new RegExp(TICKET_URL_MATCH, "g"));
		if (!match) {
			return false;
		}
		return match.every(url => jiraTickets.find(ticket => ticket.key === url.replace(new RegExp(TICKET_URL_MATCH), "$1")));
	});
}

async function getMR(mrIid) {
	const response = await fetch(buildMRUrl(mrIid));
	return await response.json();
}

function needsRebase(mr) {
	return mr.diverged_commits_count > 0 && mr.rebase_in_progress === false;
}

function buildMRUrl(mrIid) {
	return `${GITLAB_URL}/projects/${GITLAB_PROJECT_ID}/merge_requests/${mrIid}`
		+ `?private_token=${GITLAB_TOKEN}`
		+ `&include_diverged_commits_count=true`
		+ `&include_rebase_in_progress=true`;
}

async function rebaseMR(mr) {
	await fetch(buildRebaseUrl(mr.iid), {
		method: "PUT",
	});
}

function buildRebaseUrl(mrIid) {
	return `${GITLAB_URL}/projects/${GITLAB_PROJECT_ID}/merge_requests/${mrIid}/rebase?private_token=${GITLAB_TOKEN}`;
}

async function mergeMR(mr) {
	await fetch(buildMergeUrl(mr.iid), {
		method: "PUT",
	});
}

function buildMergeUrl(mrIid) {
	return `${GITLAB_URL}/projects/${GITLAB_PROJECT_ID}/merge_requests/${mrIid}/merge?private_token=${GITLAB_TOKEN}`;
}

async function isApproved(mr) {
	const response = await fetch(buildApprovalsUrl(mr.iid));
	const data = await response.json();
	return data.approved;
}

function buildApprovalsUrl(mrIid) {
	return `${GITLAB_URL}/projects/${GITLAB_PROJECT_ID}/merge_requests/${mrIid}/approvals?private_token=${GITLAB_TOKEN}`;
}

async function commitsMatchDescription(mrEntry) {
	const tickets = getJiraIds([mrEntry]);
	const response = await fetch(buildCommitsUrl(mrEntry.iid));
	const commits = await response.json();
	return commits
		.map(commit => commit.title.match(new RegExp(`(${JIRA_PROJECT_ID}-\\d+)`)))
		.every(commit => commit && tickets.find(ticket => ticket === commit[1]));
}

function buildCommitsUrl(mrIid) {
	return `${GITLAB_URL}/projects/${GITLAB_PROJECT_ID}/merge_requests/${mrIid}/commits?private_token=${GITLAB_TOKEN}`;
}
