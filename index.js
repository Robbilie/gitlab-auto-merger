const fetch = require("node-fetch");

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const JIRA_AUTH = process.env.JIRA_AUTH;

const GITLAB_URL = process.env.GITLAB_URL;
const JIRA_URL = process.env.JIRA_URL;

const GITLAB_BRANCH_NAME = process.env.GITLAB_BRANCH_NAME;
const JIRA_RELEASE_NAME = process.env.JIRA_RELEASE_NAME;
const JIRA_FIELD_NAME = process.env.JIRA_FIELD_NAME;
const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID;
const JIRA_STATUS = process.env.JIRA_STATUS ? process.env.JIRA_STATUS.split(",") : [];

run().catch(console.log);
setInterval(() => run().catch(console.log), 1000 * 60);

async function run() {
	console.log("getting merge requests");
	const gitlabMRs = await getGitlabMRs();
	console.log("getting jira tickets");
	const jiraTickets = await getJiraTickets();
	const filteredMRs = filterMRs(jiraTickets, gitlabMRs);
	for (let mrEntry of filteredMRs) {
		console.log("loading merge request:", mrEntry.iid);
		if (mrEntry.merge_status === "cannot_be_merged") {
			console.log("cannot be merged");
			continue;
		}
		const mr = await getMR(mrEntry.iid);
		if (!mr.pipeline) {
			console.log("no pipeline");
			break;
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
		+ `&sort=asc`;
}

async function getJiraTickets() {
	const response = await fetch(buildJiraUrl(), {
		method: "POST",
		headers: {
			"Authorization": `Basic ${JIRA_AUTH}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			jql: `project='MYA' and '${JIRA_FIELD_NAME}'='${JIRA_RELEASE_NAME}'`,
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

function filterMRs(jiraTickets, mrs) {
	return mrs.filter(mr => {
		const match = mr.description.match(/https:\/\/collaboration\.msi\.audi\.com\/jira\/browse\/(MYA-\d+)/);
		if (!match) {
			return false;
		}
		const ticket = jiraTickets.find(ticket => ticket.key === match[1]);
		if (!ticket) {
			return false;
		}
		if (JIRA_STATUS.length && !JIRA_STATUS.includes(ticket.fields.status.name)) {
			return false;
		}
		return true;
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
