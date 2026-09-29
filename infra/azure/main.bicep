// Primordial Health on Azure — the small, low-cost setup (D-081). One command creates everything in a resource group:
//
//   az deployment group create -g primordial-prod -f infra/azure/main.bicep \
//     -p appDomain=app.example.com apiDomain=api.example.com \
//        postgresPassword=<secret> jwtSecret=<secret> phiEncryptionKey=<secret>
//
// What it creates (≈ $30–40/month): a private container registry, one Linux App Service plan (B1) running two apps
// (dashboard + API), and PostgreSQL Flexible Server (B1ms). Azure's HIPAA BAA covers all three.
// Custom domains + free certificates are added in the portal after DNS is set (docs/DEPLOYMENT-AZURE.md).

@description('Short name used in every resource name (letters and digits).')
@minLength(3)
@maxLength(12)
param namePrefix string = 'primordial'

@description('Azure region. East US is usually the cheapest.')
param location string = resourceGroup().location

@description('The dashboard host name people will use, e.g. app.primordialhealthservices.health.')
param appDomain string

@description('The API host name, e.g. api.primordialhealthservices.health (same parent domain as appDomain, so sign-in cookies work).')
param apiDomain string

@description('Container image tag to run (the deploy workflow sets it).')
param imageTag string = 'initial'

@description('PostgreSQL administrator login.')
param postgresAdmin string = 'primordialadmin'

@secure()
@minLength(16)
param postgresPassword string

@secure()
@minLength(32)
param jwtSecret string

@secure()
@description('32 random bytes, base64 — keep a copy in a safe place: without it encrypted data cannot be read.')
param phiEncryptionKey string

@description('PostgreSQL major version.')
param postgresVersion string = '17'

// Registry names must be globally unique, lowercase, alphanumeric.
var suffix = uniqueString(resourceGroup().id)
var registryName = toLower('${namePrefix}${suffix}')
var databaseName = 'primordial'
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  kind: 'linux'
  sku: { name: 'B1', tier: 'Basic' }
  properties: { reserved: true }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${namePrefix}-db-${suffix}'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: postgresVersion
    administratorLogin: postgresAdmin
    administratorLoginPassword: postgresPassword
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Only Azure services (our App Service apps) may connect; the deploy workflow opens its own address briefly for
// migrations. TLS is required by default on Flexible Server.
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

var databaseUrl = 'postgresql://${postgresAdmin}:${uriComponent(postgresPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

// Properties are written out in full (no union()): Microsoft.Web's preflight validation fails with "Object reference
// not set to an instance of an object" when a site's whole properties block is a runtime expression.
resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-api-${suffix}'
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOCKER|${registry.properties.loginServer}/primordial-api:${imageTag}'
      acrUseManagedIdentityCreds: true
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      // App Service HTTP logs record query strings (search terms can be PHI, D-035) — leave them off.
      httpLoggingEnabled: false
      webSocketsEnabled: true
      healthCheckPath: '/api/v1/health'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '3001' }
        { name: 'APP_ENV', value: 'production' }
        { name: 'APP_PORT', value: '3001' }
        { name: 'DATABASE_URL', value: databaseUrl }
        { name: 'DATABASE_POOL_SIZE', value: '10' }
        { name: 'JWT_SECRET', value: jwtSecret }
        { name: 'PHI_ENCRYPTION_KEY', value: phiEncryptionKey }
        { name: 'PHI_ENCRYPTION_KEY_VERSION', value: '1' }
        { name: 'CORS_ORIGINS', value: 'https://${appDomain}' }
        { name: 'FRONTEND_URL', value: 'https://${appDomain}' }
        // App Service's front end is one proxy hop (D-070, D-081).
        { name: 'TRUST_PROXY_HOPS', value: '1' }
        { name: 'JOBS_ENABLED', value: 'true' }
      ]
    }
  }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-web-${suffix}'
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOCKER|${registry.properties.loginServer}/primordial-web:${imageTag}'
      acrUseManagedIdentityCreds: true
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      httpLoggingEnabled: false
      healthCheckPath: '/login'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '3000' }
        { name: 'NODE_ENV', value: 'production' }
      ]
    }
  }
}

// Both apps pull their images from the private registry with their own identity — no registry passwords.
resource apiPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, api.id, 'acrpull')
  properties: { roleDefinitionId: acrPullRoleId, principalId: api.identity.principalId, principalType: 'ServicePrincipal' }
}

resource webPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, web.id, 'acrpull')
  properties: { roleDefinitionId: acrPullRoleId, principalId: web.identity.principalId, principalType: 'ServicePrincipal' }
}

output registryLoginServer string = registry.properties.loginServer
output registryName string = registry.name
output apiAppName string = api.name
output webAppName string = web.name
output apiDefaultHost string = api.properties.defaultHostName
output webDefaultHost string = web.properties.defaultHostName
output postgresServerName string = postgres.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
@description('Build the dashboard image with this as NEXT_PUBLIC_API_URL.')
output publicApiUrl string = 'https://${apiDomain}/api/v1'
