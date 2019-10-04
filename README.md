# gitlab-auto-merger

## Run
GITLAB_TOKEN=<private_gitlab_token>
JIRA_AUTH=<btoa(jira_username:jira_password)>
GITLAB_URL=<gitlab_api_url>
JIRA_URL=<jira_api_url>
GITLAB_BRANCH_NAME=<gitlab_branch_name>
JIRA_RELEASE_NAME=<jira_release_name>
JIRA_FIELD_NAME=<jira_field_name>
GITLAB_PROJECT_ID=<gitlab_project_id>
JIRA_PROJECT_ID=<jira_project_id>
JIRA_STATUS=<jira_ticket_status>
ALLOW_EMPTY_JIRA_FIELD=<allow_empty_jira_field>
node index.js
