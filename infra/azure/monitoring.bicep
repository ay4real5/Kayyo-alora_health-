// Primordial Health — alerts that email the owner when something is wrong (D-087). Deployed once, separately from
// main.bicep, into the same resource group; it needs no secrets:
//
//   az deployment group create -g primordial-prod -f infra/azure/monitoring.bicep -p alertEmail=you@example.com
//
// It watches the resources main.bicep created (same names: prefix + uniqueString of the resource group). Uses Azure
// Monitor metric alerts only — about $1–2 a month — and App Service's built-in health check (/api/v1/health, /login).

@description('Who gets the alert emails.')
param alertEmail string

@description('Same prefix as main.bicep.')
param namePrefix string = 'primordial'

var suffix = uniqueString(resourceGroup().id)

resource api 'Microsoft.Web/sites@2023-12-01' existing = {
  name: '${namePrefix}-api-${suffix}'
}

resource web 'Microsoft.Web/sites@2023-12-01' existing = {
  name: '${namePrefix}-web-${suffix}'
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' existing = {
  name: '${namePrefix}-plan'
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: '${namePrefix}-db-${suffix}'
}

resource owner 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${namePrefix}-owner-alerts'
  location: 'global'
  properties: {
    groupShortName: 'PrimAlerts'
    enabled: true
    emailReceivers: [
      { name: 'owner', emailAddress: alertEmail, useCommonAlertSchema: true }
    ]
  }
}

// One rule per condition (metric, aggregation, threshold, window). Severity 1 = down, 2 = errors,
// 3 = running out of room.
var rules = [
  {
    name: 'api-down'
    scope: api.id
    ns: 'Microsoft.Web/sites'
    metric: 'HealthCheckStatus'
    agg: 'Average'
    op: 'LessThan'
    threshold: 100
    window: 'PT5M'
    severity: 1
    text: 'The API is failing its health check (/api/v1/health). Staff and the caregiver app cannot work. Check Log stream on the API app.'
  }
  {
    name: 'dashboard-down'
    scope: web.id
    ns: 'Microsoft.Web/sites'
    metric: 'HealthCheckStatus'
    agg: 'Average'
    op: 'LessThan'
    threshold: 100
    window: 'PT5M'
    severity: 1
    text: 'The dashboard is failing its health check (/login). Check Log stream on the web app.'
  }
  {
    name: 'api-server-errors'
    scope: api.id
    ns: 'Microsoft.Web/sites'
    metric: 'Http5xx'
    agg: 'Total'
    op: 'GreaterThan'
    threshold: 20
    window: 'PT15M'
    severity: 2
    text: 'The API returned more than 20 server errors in 15 minutes. Check Log stream on the API app.'
  }
  {
    name: 'database-down'
    scope: postgres.id
    ns: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'is_db_alive'
    agg: 'Minimum'
    op: 'LessThan'
    threshold: 1
    window: 'PT5M'
    severity: 1
    text: 'The database is not responding.'
  }
  {
    name: 'database-storage'
    scope: postgres.id
    ns: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'storage_percent'
    agg: 'Average'
    op: 'GreaterThan'
    threshold: 80
    window: 'PT30M'
    severity: 3
    text: 'Database storage is over 80% full (it grows automatically, but the bill grows with it).'
  }
  {
    name: 'database-cpu'
    scope: postgres.id
    ns: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'cpu_percent'
    agg: 'Average'
    op: 'GreaterThan'
    threshold: 90
    window: 'PT30M'
    severity: 3
    text: 'The database has been over 90% busy for 30 minutes — time to consider the next size up.'
  }
  {
    name: 'app-plan-memory'
    scope: plan.id
    ns: 'Microsoft.Web/serverfarms'
    metric: 'MemoryPercentage'
    agg: 'Average'
    op: 'GreaterThan'
    threshold: 90
    window: 'PT30M'
    severity: 3
    text: 'The app server has been over 90% memory for 30 minutes — time to consider the next plan size.'
  }
]

resource alerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for r in rules: {
    name: '${namePrefix}-${r.name}'
    location: 'global'
    properties: {
      description: r.text
      severity: r.severity
      enabled: true
      scopes: [r.scope]
      evaluationFrequency: 'PT1M'
      windowSize: r.window
      autoMitigate: true
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: r.name
            metricNamespace: r.ns
            metricName: r.metric
            timeAggregation: r.agg
            operator: r.op
            threshold: r.threshold
          }
        ]
      }
      actions: [{ actionGroupId: owner.id }]
    }
  }
]

output alertRules array = [for (r, i) in rules: alerts[i].name]
