# OV-chipkaart API Research Notes

## Mobile Gateway API (CONFIRMED — used by official Android app)

Base: `https://api2.ov-chipkaart.nl/femobilegateway/v1`
Auth: `https://login.ov-chipkaart.nl/oauth2/token`

### Step 1 — OAuth2 token
```
POST https://login.ov-chipkaart.nl/oauth2/token
Content-Type: application/x-www-form-urlencoded

username=<email>&password=<pw>&client_id=<app_client_id>
&client_secret=<app_client_secret>&grant_type=password&scope=openid
```
Returns: `{ access_token, ... }`

### Step 2 — Exchange for authorizationToken
```
POST /api/authorize
Body: authenticationToken=<access_token>
```
Returns: `{ c: 200, o: { authorizationToken: "..." } }`

### Step 3 — List cards
```
POST /cards/list
Body: authorizationToken=<token>&locale=nl
```
Returns: array of cards, each with `mediumId` (card number).

### Step 4 — Fetch transactions (paginated)
```
POST /transaction/list
Body: authorizationToken=<token>&mediumId=<id>&offset=0&locale=nl
```
Response:
```json
{
  "c": 200,
  "o": {
    "totalSize": 842,
    "nextOffset": 20,
    "records": [
      {
        "transactionDateTime": 1700000000000,
        "transactionName": "Incheck",       // or "Uitcheck"
        "transactionInfo": "Amsterdam Centraal",
        "pto": "NS",
        "fare": 450,                         // eurocents
        "ePurseMut": -450,
        "modalType": "Trein",
        "productText": "2e klas",
        "checkInInfo": "...",
        "fareText": "€ 4,50"
      }
    ]
  }
}
```

**Pagination**: `offset` increments to `nextOffset` each page, 20 records/page.  
**No date range filter**: returns ALL transactions oldest→newest. Use offset to paginate.  
**Rate limit**: add ≥500 ms between pages (0.6 s used in our code).

### Source
- [costastf/ovchipcardlib](https://github.com/costastf/ovchipcardlib) — Python (active until Dec 2022)
- [dylanvdbrink/ovchipapi](https://github.com/dylanvdbrink/ovchipapi) — C# (archived Jun 2022)

---

## Website API (ov-chipkaart.nl/backend/moc) — PARTIALLY KNOWN

### Generate Document (CSV export) — CONFIRMED
```
POST https://www.ov-chipkaart.nl/backend/moc/cardtravelhistory/generatedocument
Content-Type: application/json
Auth: session cookies

Body: {
  "selectedTransactions": [{"id": 1, "isSelected": true}, ...],
  // + date range fields (exact names TBD)
}
```
Returns: `{ document: { content: "<base64 CSV>" } }`

**ID trick**: select all IDs from min→max to include check-in rows (departure station).

### Listing endpoint — UNKNOWN
Still not confirmed. Use xhr_logger.js to discover it if website approach is needed.

---

## Decision
Extension uses the **Mobile Gateway API** — cleaner, fully paginated, no date limit,
no need to reverse-engineer the website listing endpoint.
