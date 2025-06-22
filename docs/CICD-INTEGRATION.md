# MCP Memory Keeper - CI/CD Integration Guide

## Overview

MCP Memory Keeper can be integrated into your CI/CD pipeline to automatically track build states, test results, deployment history, and code evolution. This guide covers integration patterns for popular CI/CD platforms.

## GitHub Actions Integration

### Basic Integration

Add MCP Memory Keeper to your GitHub Actions workflow:

```yaml
name: CI with Memory Keeper
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install MCP Memory Keeper
        run: npm install -g mcp-memory-keeper
      
      - name: Start Memory Keeper Session
        run: |
          mcp-memory-keeper start-session \
            --name "CI Build ${{ github.run_number }}" \
            --project-dir "${{ github.workspace }}"
      
      - name: Save Build Context
        run: |
          mcp-memory-keeper save \
            --key "build_info" \
            --value "Branch: ${{ github.ref }}, SHA: ${{ github.sha }}" \
            --category "task" \
            --priority "high"
      
      - name: Run Tests
        run: |
          npm test 2>&1 | tee test-results.log
          TEST_EXIT_CODE=${PIPESTATUS[0]}
          
          # Save test results
          mcp-memory-keeper save \
            --key "test_results" \
            --value "$(cat test-results.log)" \
            --category "progress"
          
          exit $TEST_EXIT_CODE
      
      - name: Create Checkpoint
        if: always()
        run: |
          mcp-memory-keeper checkpoint \
            --name "build-${{ github.run_number }}" \
            --include-git-status
```

### Advanced Patterns

#### Test Failure Analysis

```yaml
- name: Analyze Test Failures
  if: failure()
  run: |
    # Extract failed test names
    FAILED_TESTS=$(grep -E "(FAIL|✗)" test-results.log | head -20)
    
    # Save failure context
    mcp-memory-keeper save \
      --key "test_failures_${{ github.run_number }}" \
      --value "$FAILED_TESTS" \
      --category "error" \
      --priority "critical"
    
    # Analyze patterns in failures
    mcp-memory-keeper delegate \
      --task "analyze" \
      --type "patterns" \
      --categories "error"
```

#### Performance Tracking

```yaml
- name: Track Performance Metrics
  run: |
    # Run performance tests
    npm run perf-test > perf-results.json
    
    # Save metrics
    mcp-memory-keeper save \
      --key "perf_metrics_${{ github.run_number }}" \
      --value "$(cat perf-results.json)" \
      --category "progress" \
      --metadata '{"type": "performance", "branch": "${{ github.ref }}"}'
    
    # Compare with previous builds
    mcp-memory-keeper semantic-search \
      --query "performance metrics" \
      --limit 5 | \
    mcp-memory-keeper delegate \
      --task "analyze" \
      --type "trends"
```

## GitLab CI Integration

### Basic Setup

`.gitlab-ci.yml`:

```yaml
variables:
  MCP_DB_PATH: "$CI_PROJECT_DIR/.mcp/context.db"

before_script:
  - npm install -g mcp-memory-keeper
  - |
    mcp-memory-keeper start-session \
      --name "Pipeline $CI_PIPELINE_ID" \
      --project-dir "$CI_PROJECT_DIR"

stages:
  - build
  - test
  - deploy
  - analyze

build:
  stage: build
  script:
    - |
      mcp-memory-keeper save \
        --key "build_start" \
        --value "Building $CI_COMMIT_REF_NAME at $CI_COMMIT_SHA" \
        --category "task"
    - npm run build
    - |
      mcp-memory-keeper save \
        --key "build_artifacts" \
        --value "$(ls -la dist/)" \
        --category "progress"

test:
  stage: test
  script:
    - npm test -- --json > test-results.json
    - |
      mcp-memory-keeper save \
        --key "test_results" \
        --value "$(cat test-results.json)" \
        --category "progress"
  after_script:
    - |
      mcp-memory-keeper checkpoint \
        --name "test-complete-$CI_PIPELINE_ID"

analyze:
  stage: analyze
  when: always
  script:
    - |
      # Generate build summary
      mcp-memory-keeper summarize \
        --categories "task,progress,error" \
        --format "markdown" > build-summary.md
    - |
      # Analyze patterns
      mcp-memory-keeper delegate \
        --task "analyze" \
        --type "comprehensive" > analysis.json
  artifacts:
    reports:
      - build-summary.md
      - analysis.json
```

### Merge Request Integration

```yaml
merge_request_analysis:
  stage: analyze
  only:
    - merge_requests
  script:
    - |
      # Compare with target branch
      git checkout $CI_MERGE_REQUEST_TARGET_BRANCH_NAME
      mcp-memory-keeper checkpoint --name "target-branch-state"
      
      git checkout $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME
      mcp-memory-keeper checkpoint --name "source-branch-state"
      
      # Analyze differences
      mcp-memory-keeper delegate \
        --task "analyze" \
        --type "relationships" \
        --input '{"compareCheckpoints": ["target-branch-state", "source-branch-state"]}'
```

## Jenkins Integration

### Pipeline Script

```groovy
pipeline {
    agent any
    
    environment {
        MCP_SESSION = "${env.JOB_NAME}-${env.BUILD_NUMBER}"
    }
    
    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g mcp-memory-keeper'
                sh """
                    mcp-memory-keeper start-session \
                        --name "${MCP_SESSION}" \
                        --project-dir "${WORKSPACE}"
                """
            }
        }
        
        stage('Build') {
            steps {
                script {
                    // Save build parameters
                    sh """
                        mcp-memory-keeper save \
                            --key "build_params" \
                            --value '${params}' \
                            --category "task"
                    """
                    
                    // Run build
                    sh 'npm run build'
                }
            }
        }
        
        stage('Test') {
            steps {
                script {
                    def testStatus = sh(
                        script: 'npm test',
                        returnStatus: true
                    )
                    
                    sh """
                        mcp-memory-keeper save \
                            --key "test_status" \
                            --value "${testStatus == 0 ? 'PASSED' : 'FAILED'}" \
                            --category "${testStatus == 0 ? 'progress' : 'error'}" \
                            --priority "${testStatus == 0 ? 'normal' : 'critical'}"
                    """
                    
                    if (testStatus != 0) {
                        error("Tests failed")
                    }
                }
            }
        }
        
        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                script {
                    sh """
                        mcp-memory-keeper save \
                            --key "deployment_${BUILD_NUMBER}" \
                            --value "Deploying to production" \
                            --category "task" \
                            --priority "critical"
                    """
                    
                    // Deploy steps...
                }
            }
        }
    }
    
    post {
        always {
            script {
                // Create checkpoint
                sh """
                    mcp-memory-keeper checkpoint \
                        --name "jenkins-${BUILD_NUMBER}" \
                        --include-git-status
                """
                
                // Generate report
                sh """
                    mcp-memory-keeper summarize \
                        --format "json" > mcp-summary.json
                """
                
                archiveArtifacts artifacts: 'mcp-summary.json'
            }
        }
        failure {
            script {
                // Analyze failures
                sh """
                    mcp-memory-keeper delegate \
                        --task "analyze" \
                        --type "patterns" \
                        --categories "error" > failure-analysis.json
                """
                
                emailext(
                    subject: "Build Failed - ${JOB_NAME} #${BUILD_NUMBER}",
                    body: readFile('failure-analysis.json'),
                    to: "${TEAM_EMAIL}"
                )
            }
        }
    }
}
```

## CircleCI Integration

`.circleci/config.yml`:

```yaml
version: 2.1

executors:
  node-executor:
    docker:
      - image: cimg/node:20.0

jobs:
  build-and-test:
    executor: node-executor
    steps:
      - checkout
      
      - run:
          name: Install MCP Memory Keeper
          command: npm install -g mcp-memory-keeper
      
      - run:
          name: Start MCP Session
          command: |
            mcp-memory-keeper start-session \
              --name "CircleCI-${CIRCLE_BUILD_NUM}" \
              --project-dir "$CIRCLE_WORKING_DIRECTORY"
      
      - run:
          name: Save Build Context
          command: |
            mcp-memory-keeper save \
              --key "circle_context" \
              --value "Branch: ${CIRCLE_BRANCH}, PR: ${CIRCLE_PULL_REQUEST:-none}" \
              --category "task"
      
      - run:
          name: Run Tests
          command: |
            npm test 2>&1 | tee test-output.log
            TEST_RESULT=$?
            
            mcp-memory-keeper save \
              --key "test_output" \
              --value "$(cat test-output.log)" \
              --category "progress"
            
            exit $TEST_RESULT
      
      - run:
          name: Analyze Code Coverage
          when: always
          command: |
            npm run coverage
            
            mcp-memory-keeper save \
              --key "coverage_${CIRCLE_BUILD_NUM}" \
              --value "$(cat coverage/lcov-report/index.html | grep -A 5 'percentage')" \
              --category "progress"
      
      - run:
          name: Create Checkpoint
          when: always
          command: |
            mcp-memory-keeper checkpoint \
              --name "build-${CIRCLE_BUILD_NUM}" \
              --include-git-status

workflows:
  version: 2
  build-test-deploy:
    jobs:
      - build-and-test
```

## Best Practices

### 1. Consistent Naming

Use consistent naming patterns for sessions and checkpoints:

```bash
# Sessions
"${CI_PLATFORM}-${BUILD_NUMBER}"
"${BRANCH_NAME}-${COMMIT_SHA:0:7}"

# Checkpoints
"pre-deploy-${VERSION}"
"post-test-${BUILD_NUMBER}"
"release-${TAG_NAME}"
```

### 2. Structured Metadata

Always include relevant CI/CD metadata:

```bash
mcp-memory-keeper save \
  --key "build_metadata" \
  --value "Build completed" \
  --metadata '{
    "platform": "github-actions",
    "build_number": "'$BUILD_NUMBER'",
    "branch": "'$BRANCH_NAME'",
    "commit": "'$COMMIT_SHA'",
    "triggered_by": "'$TRIGGER_USER'",
    "duration": "'$BUILD_DURATION'"
  }'
```

### 3. Failure Context

Capture comprehensive context on failures:

```bash
# On test failure
if [ $TEST_EXIT_CODE -ne 0 ]; then
  # Save error logs
  mcp-memory-keeper save \
    --key "test_failure_logs" \
    --value "$(tail -n 100 test.log)" \
    --category "error" \
    --priority "critical"
  
  # Save environment info
  mcp-memory-keeper save \
    --key "failure_environment" \
    --value "$(env | grep -E 'NODE_|NPM_|CI_')" \
    --category "error"
  
  # Save recent commits
  mcp-memory-keeper save \
    --key "recent_commits" \
    --value "$(git log --oneline -10)" \
    --category "error"
fi
```

### 4. Performance Tracking

Track build performance over time:

```bash
# Record build times
START_TIME=$(date +%s)
# ... build steps ...
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

mcp-memory-keeper save \
  --key "build_performance" \
  --value "$DURATION seconds" \
  --category "progress" \
  --metadata '{
    "stage": "build",
    "duration_seconds": '$DURATION',
    "commit": "'$COMMIT_SHA'"
  }'
```

### 5. Artifact Tracking

Track build artifacts and their locations:

```bash
# After build
ARTIFACTS=$(find dist -type f -name "*.js" -o -name "*.css" | head -20)

mcp-memory-keeper save \
  --key "build_artifacts" \
  --value "$ARTIFACTS" \
  --category "progress" \
  --metadata '{
    "artifact_count": "'$(echo "$ARTIFACTS" | wc -l)'",
    "total_size": "'$(du -sh dist | cut -f1)'"
  }'
```

## Query Patterns

### Finding Failed Builds

```bash
# Recent failures
mcp-memory-keeper search \
  --query "failed OR error" \
  --categories "error" \
  --limit 10

# Failures on specific branch
mcp-memory-keeper semantic-search \
  --query "test failures on main branch" \
  --min-similarity 0.7
```

### Analyzing Trends

```bash
# Build time trends
mcp-memory-keeper get \
  --category "progress" \
  --key-pattern "build_performance" | \
mcp-memory-keeper delegate \
  --task "analyze" \
  --type "trends"
```

### Comparing Branches

```bash
# Compare feature branch with main
mcp-memory-keeper analyze \
  --sessions "main-latest,feature-xyz-latest" \
  --type "relationships"
```

## Troubleshooting

### Session Persistence

For ephemeral CI/CD environments, export sessions:

```bash
# End of build
mcp-memory-keeper export \
  --format "json" \
  --output "mcp-session-${BUILD_NUMBER}.json"

# Upload to artifact storage
aws s3 cp "mcp-session-${BUILD_NUMBER}.json" \
  "s3://my-bucket/mcp-sessions/"
```

### Memory Limits

In constrained environments:

```bash
# Compress old data
mcp-memory-keeper compress \
  --older-than "7 days ago" \
  --preserve-categories "error,critical"

# Limit session size
export MCP_MAX_SESSION_SIZE="10MB"
```

### Debugging

Enable verbose logging:

```bash
export MCP_LOG_LEVEL="debug"
mcp-memory-keeper save --key "test" --value "data"
```

## Integration with Other Tools

### Slack Notifications

```bash
# On build completion
SUMMARY=$(mcp-memory-keeper summarize --format "text" --max-length 500)

curl -X POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Build #'$BUILD_NUMBER' completed",
    "attachments": [{
      "color": "'$BUILD_STATUS'",
      "text": "'"$SUMMARY"'"
    }]
  }'
```

### JIRA Integration

```bash
# Extract JIRA ticket numbers
TICKETS=$(mcp-memory-keeper get --category "task" | \
  grep -oE '[A-Z]+-[0-9]+' | sort -u)

# Update JIRA
for ticket in $TICKETS; do
  curl -X POST "https://jira.company.com/rest/api/2/issue/$ticket/comment" \
    -H "Authorization: Bearer $JIRA_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "body": "Build #'$BUILD_NUMBER' completed. View details at '$BUILD_URL'"
    }'
done
```

This comprehensive guide enables teams to leverage MCP Memory Keeper throughout their CI/CD pipeline for better visibility, debugging, and historical analysis of their build processes.