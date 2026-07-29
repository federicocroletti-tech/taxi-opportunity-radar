# Deploy su GitHub Actions - Taxi Opportunity Radar

## Obiettivo

Questo documento spiega come eseguire automaticamente Taxi Opportunity Radar su GitHub Actions ogni giorno lavorativo, con invio email opzionale tramite Brevo.

Nota importante: GitHub Actions non ospita una web app in modo permanente. In questo progetto, "deploy su GitHub Actions" significa configurare una pipeline schedulata che esegue lo script, genera il report e invia email.

## Prerequisiti

- Repository presente su GitHub.
- Workflow già versionato in `.github/workflows/daily-radar.yml`.
- Build locale funzionante:

```bash
npm install
npm run build
npm start
```

## File coinvolti

- `.github/workflows/daily-radar.yml`: pipeline schedulata.
- `package.json`: script `build` e `start` usati dal workflow.
- `config/events.json`: eventi manuali letti durante l'esecuzione.
- `src/index.ts`: entrypoint applicativo.

## Passo 1 - Verifica workflow

Workflow attuale:

- trigger automatico lun-ven con cron `0 6 * * 1-5`.
- trigger manuale con `workflow_dispatch`.
- install dipendenze con `npm ci`.
- build TypeScript con `npm run build`.
- avvio report con `npm start`.

Se vuoi cambiare orario, modifica il cron nel file workflow.

Esempio (08:00 UTC):

```yaml
schedule:
  - cron: "0 8 * * 1-5"
```

## Passo 2 - Configura Secret GitHub

Vai in:

- Repository -> Settings -> Secrets and variables -> Actions -> New repository secret

Crea questi secret:

- `BREVO_API_KEY`
- `EMAIL_FROM`
- `EMAIL_TO`
- `EMAIL_FROM_NAME` (opzionale)

Se i secret email non sono presenti, la pipeline funziona comunque e stampa il report su log senza inviare email.

## Passo 3 - Commit e push

Esegui:

```bash
git add .
git commit -m "Add GitHub Actions deployment guide"
git push
```

Dopo il push, il workflow compare nella tab Actions del repository.

## Passo 4 - Primo test manuale

1. Apri GitHub -> tab Actions.
2. Seleziona workflow "Daily Taxi Radar".
3. Clicca "Run workflow".
4. Attendi il completamento del job `run-radar`.

## Passo 5 - Verifica esito

Controlla nel log:

- step `Install` completato.
- step `Build` completato.
- step `Run radar` completato.
- output con sezione "TAXI OPPORTUNITY RADAR".

Con secret presenti, verifica anche ricezione email su `EMAIL_TO`.

## Gestione eventi giornalieri

L'app usa `config/events.json` dal repository. Hai due opzioni:

1. aggiornamento manuale del file prima dell'orario schedulato.
2. mantenere un set base di eventi ricorrenti e aggiornarlo periodicamente.

## Troubleshooting

### Errore TypeScript in build

- Verifica lockfile e dipendenze aggiornate.
- Esegui localmente `npm ci` e `npm run build`.

### Email non inviata

- Controlla presenza e valore dei secret Brevo.
- Verifica che `EMAIL_FROM` sia autorizzata in Brevo.
- Controlla limiti piano Brevo.

### Workflow non parte allo schedule

- Verifica che il workflow sia su branch predefinito (es. `main`).
- Verifica che Actions sia abilitato nel repository.
- Ricorda che il cron è in UTC.

### Eventi non considerati

- Verifica JSON valido in `config/events.json`.
- Controlla campi obbligatori: `name`, `area`, `startTimeLocal`, `endTimeLocal`, `expectedAttendance`.

## Hardening consigliato

- Aggiungere notifica errore (es. email fallback o issue automatica) in caso di job fallito.
- Aggiungere step test (`npm run test`) quando verranno introdotti test automatici.
- Versionare una policy operativa per aggiornare `config/events.json`.

## Checklist finale

- Workflow presente e valido.
- Secret configurati.
- Esecuzione manuale OK.
- Esecuzione schedulata OK.
- Email ricevuta (se abilitata).
