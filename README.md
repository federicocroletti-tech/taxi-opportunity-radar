# Taxi Opportunity Radar

Sistema che monitora eventi, meteo e altre opportunità locali per aiutare tassisti e NCC a individuare le aree con maggiore domanda potenziale.

## MVP

- Meteo Milano
- Eventi dal web
- Calcolo score
- Email giornaliera

## Funzionalita implementate

- Lettura meteo da Open-Meteo (pioggia, temperatura massima, vento massimo)
- Lettura eventi dal web da sorgenti configurate in `config/event-sources.json`
- Calcolo score per area con ranking opportunita
- Calcolo city score sintetico
- Report testuale su console
- Invio email opzionale tramite Brevo API

## Setup rapido

```bash
npm install
npm run build
npm start
```

Per sviluppo senza build:

```bash
npm run dev
```

## Configurazione sorgenti eventi web

Modifica `config/event-sources.json` per scegliere le pagine da cui leggere gli eventi.

Esempio struttura:

```json
{
  "city": "Milano",
  "sources": [
    {
      "name": "San Siro Eventi",
      "url": "https://www.sansirostadium.com/eventi/",
      "kind": "concert",
      "defaultArea": "San Siro",
      "defaultAttendance": 45000,
      "maxEvents": 8
    }
  ]
}
```

Il parser legge i blocchi `application/ld+json` di tipo `Event` direttamente dalle pagine web.

Se nel tuo ambiente locale Node non riesce a validare alcuni certificati HTTPS delle sorgenti eventi, puoi usare temporaneamente:

```bash
EVENTS_ALLOW_INSECURE_TLS=true
```

In produzione lascia questa variabile disattivata (`false` o assente).

## Fallback tecnico

Se tutte le sorgenti web sono irraggiungibili o non contengono eventi validi, l'app usa `config/events.json` solo come fallback di continuità operativa per non interrompere il job GitHub Actions.

Tipi evento supportati (`kind`):

- `concert`
- `sports`
- `fair`
- `transport-disruption`
- `nightlife`

## Configurazione email Brevo (opzionale)

Se vuoi invio giornaliero via email, imposta variabili ambiente:

```bash
BREVO_API_KEY=...
EMAIL_FROM=...
EMAIL_TO=...
EMAIL_FROM_NAME=Taxi Opportunity Radar
```

Puoi copiare il file esempio:

```bash
cp .env.example .env
```

Su Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Se le variabili non sono presenti, il programma resta funzionante e stampa solo il report su console.

## GitHub Actions (esecuzione automatica)

Workflow incluso: `.github/workflows/daily-radar.yml`

Guida completa di deploy operativo: `docs/DEPLOY-GITHUB-ACTIONS.md`

- esecuzione pianificata lun-ven ore 06:00 UTC
- esecuzione manuale via `workflow_dispatch`

Secret GitHub consigliati:

- `BREVO_API_KEY`
- `EMAIL_FROM`
- `EMAIL_TO`
- `EMAIL_FROM_NAME` (opzionale)

## Roadmap

### V1

- Open Meteo
- Brevo email
- GitHub Actions

### V2

- Eventi San Siro
- Fiera Milano
- Forum Assago
- ATM e Trenord

### V3

- Dashboard Angular
- Storico score
- Suggerimenti automatici
