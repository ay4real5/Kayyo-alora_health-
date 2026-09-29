# Deploying Primordial Health on Azure (small start)

The low-cost Azure setup (DECISIONS D-081): about **$30–40 a month**, and Azure's HIPAA **BAA is included
automatically** for every customer (it's part of Microsoft's Product Terms — nothing to sign). Everything below
is done in the browser with **Azure Cloud Shell** (the `>_` icon at the top of the Azure portal) — nothing to
install.

| Piece | Azure service | ≈ per month |
|---|---|---|
| Dashboard + API (two apps on one plan) | App Service plan, Linux **B1** | $13 |
| Database | PostgreSQL Flexible Server **B1ms**, 32 GB, 14-day backups | $15–20 |
| Private image registry | Container Registry **Basic** | $5 |
| **Total** | | **≈ $33–38** |

Tip: apply to **Microsoft for Startups** (Founders Hub) first — new companies get Azure credit that can cover the
first months.

## What you need before starting

1. **The domain** `primordialhealthservices.health` (already owned, at Namecheap). The dashboard will be
   `app.primordialhealthservices.health` and the API `api.primordialhealthservices.health`; the existing website
   (`www.` / the bare domain) is not touched. *Using the domain is required*: on Azure's free
   `*.azurewebsites.net` names the browser treats the two apps as different sites and blocks the sign-in cookie,
   so staff would be signed out on every page reload.
2. **The GitHub repository set to private** (P4-12).
3. A password manager to keep the secrets you'll generate in step 2.

## 1. Create the Azure pieces (10 minutes)

In Cloud Shell (Bash), upload `infra/azure/main.bicep` (Upload button in the Cloud Shell toolbar), then:

```bash
az group create --name primordial-rg --location eastus

# New secrets — copy all three into your password manager NOW. Losing PHI_KEY makes encrypted data unreadable.
PG_PASSWORD=$(openssl rand -base64 30 | tr -d '/+=')
JWT_SECRET=$(openssl rand -base64 48)
PHI_KEY=$(openssl rand -base64 32)
echo "PG_PASSWORD=$PG_PASSWORD"; echo "JWT_SECRET=$JWT_SECRET"; echo "PHI_KEY=$PHI_KEY"

az deployment group create --resource-group primordial-rg --template-file main.bicep \
  --parameters appDomain=app.primordialhealthservices.health apiDomain=api.primordialhealthservices.health \
               postgresPassword="$PG_PASSWORD" jwtSecret="$JWT_SECRET" phiEncryptionKey="$PHI_KEY" \
  --query properties.outputs
```

Keep the output: it lists the registry, app and database names you'll need below. The two apps show an error page
until the first deploy (step 4) — that's expected.

## 2. Point your domain at Azure (15 minutes + DNS wait)

For each app — `primordial-web-…` gets `app`, `primordial-api-…` gets `api` — open it in the portal → **Custom
domains** → **Add custom domain** → domain `app.primordialhealthservices.health` (or `api.…`). The portal shows the
**Custom Domain Verification ID** and the app's `….azurewebsites.net` name.

At **Namecheap** → Domain List → *primordialhealthservices.health* → **Manage** → **Advanced DNS** → **Add New
Record**, add for each:

| Type | Host | Value |
|---|---|---|
| CNAME | `app` | the web app's `….azurewebsites.net` name |
| TXT | `asuid.app` | the verification ID |
| CNAME | `api` | the API app's `….azurewebsites.net` name |
| TXT | `asuid.api` | the verification ID |

Leave the existing records (your website) as they are. After a few minutes, back in the portal click **Validate**,
then **Add**, and choose **App Service Managed Certificate** (free HTTPS).

## 3. Let GitHub deploy (10 minutes)

In Cloud Shell (replace the repository name if it changed):

```bash
SUB=$(az account show --query id -o tsv); TENANT=$(az account show --query tenantId -o tsv)
APP_ID=$(az ad app create --display-name primordial-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID" -o none
az role assignment create --assignee "$APP_ID" --role Contributor --scope "/subscriptions/$SUB/resourceGroups/primordial-rg" -o none
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:ay4real5/Kayyo-alora_health-:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'
echo "AZURE_CLIENT_ID=$APP_ID"; echo "AZURE_TENANT_ID=$TENANT"; echo "AZURE_SUBSCRIPTION_ID=$SUB"
```

This uses OpenID Connect: GitHub proves who it is at each run, and no Azure password is stored anywhere.

In GitHub → **Settings → Environments**, create an environment named **`production`** (optionally require your
approval before each deploy). Then **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | printed above |
| `AZURE_DATABASE_URL` | `postgresql://primordialadmin:<PG_PASSWORD>@<postgresHost>:5432/primordial?sslmode=require` |

| Variable | Value (from step 1's output) |
|---|---|
| `AZURE_RESOURCE_GROUP` | `primordial-rg` |
| `AZURE_REGISTRY` | `registryName` |
| `AZURE_API_APP` / `AZURE_WEB_APP` | `apiAppName` / `webAppName` |
| `AZURE_POSTGRES_SERVER` | `postgresServerName` |
| `PUBLIC_API_URL` | `https://api.primordialhealthservices.health/api/v1` |

## 4. Deploy

GitHub → **Actions → Deploy to Azure → Run workflow**. It builds the three images into your private registry,
applies database migrations (opening the database to its own address only for that minute), rolls out both apps
and checks they're healthy. Run it again whenever you want the latest version.

## 5. Create your agency and first administrator

From a computer with the code (the database only accepts Azure services, so open it for yourself briefly: portal →
the PostgreSQL server → **Networking** → **Add current client IP address** → Save):

```bash
npm install && npm run build
DATABASE_URL='<the AZURE_DATABASE_URL above>' npm run agency:create -w @alora/api -- \
  --name "Your Agency Name" --email you@youragency.com --first Your --last Name --timezone America/New_York --state VA
```

It prints a **temporary password once**. Remove your IP from the database's Networking page again. Then sign in at
`https://app.primordialhealthservices.health`: you'll choose your own password and set up two-factor authentication. **Never run the
demo seed (`db:seed`) against this database.**

## Later, when needed

- **Email** (password resets, alerts): Amazon SES works from Azure too (its own free AWS BAA) — add the App Settings
  `EMAIL_PROVIDER=ses`, `EMAIL_FROM`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (an AWS user allowed
  only `ses:SendEmail`) to the API app. Azure's own email service can replace it once it's confirmed on Microsoft's
  HIPAA in-scope list.
- **Texts / phone check-in**: Twilio App Settings (see `.env.production.example`); the check-in number's webhook is
  `https://api.primordialhealthservices.health/api/v1/ivr/voice`.
- **Hardening as you grow**: secrets from App Settings into Key Vault; the database on a private network instead of
  "Azure services only"; a standby database (zone-redundant HA, ≈ doubles the database cost); larger plans.
- **Logs**: keep App Service **HTTP logging off** — it records full URLs, and search terms can be patient
  information (D-035). The container's own log (Log stream) is fine.
- **Caregiver app**: build it with `EXPO_PUBLIC_API_URL=https://api.primordialhealthservices.health/api/v1`.
