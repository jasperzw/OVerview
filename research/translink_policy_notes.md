# Translink / ov-chipkaart.nl policy review

Reviewed 2026-06-11, prompted by a WAF timeout on ov-chipkaart.nl during scraping.
Question: does OVerzicht's scraping violate Translink's terms?

## What was reviewed

- [Algemene Voorwaarden OV-chipkaart 2024 (PDF)](https://www.htm.nl/media/js3pak4q/2024-1_nl_ovchipkaart.pdf)
  (in werking 2024-01-01, gedeponeerd KvK 30177126) — read in full
- [ov-chipkaart.nl/voorwaarden](https://www.ov-chipkaart.nl/voorwaarden) and the
  [English terms index](https://www.ov-chipkaart.nl/en/terms-and-conditions)
- [Privacy page](https://www.ov-chipkaart.nl/privacy)
- `https://www.ov-chipkaart.nl/disclaimer` → **404** (no separate website disclaimer found)
- `https://www.ov-chipkaart.nl/robots.txt` → **404**

## Findings

**No clause forbids what the extension does.** The Algemene Voorwaarden govern the card,
not the website, and contain no terms about automated access, scraping, or bots:

- **Art. 33** (anti-circumvention) prohibits tampering with "de beveiligingsmaatregelen
  **op de OV-chipkaart**" — the physical chip (cloning/forging), not the website.
- **Art. 50** defines fraud as "het kopiëren of vervalsen van een OV-chipkaart".
- **Art. 18**: Translink may end a Mijn OV-chipkaart account after 12 months of inactivity;
  nothing about how the account may be accessed.

The extension fetches the holder's *own* travel history through the site's *own* backend
endpoints with the holder's *own* logged-in session — functionally identical to using the
UI, and aligned with GDPR data portability.

**Where the exposure is:**

- **Art. 63h** is broad: the gebruiksrecht can be ended for "een zwaarwegend belang …
  ter bescherming van de werking van het OV-chipkaartsysteem of als wij misbruik … 
  constateren of een redelijk vermoeden daarvan hebben". Traffic that trips their security
  tooling could be framed that way. The realistic first consequence is the link11 WAF
  block (HTTP 471 / timeouts), which is what happened.
- Deliberately **evading** the WAF would badly weaken the legal position
  (cf. the Dutch computervredebreuk discussion, e.g.
  [Ius Mentis](https://blog.iusmentis.com/2016/11/04/is-scrapen-website-computervredebreuk/)).
  Backing off when blocked keeps the use clearly legitimate.

**Mitigating facts:**

- Travel history is only retained **±18 months**
  ([reishistorie FAQ](https://www.ov-chipkaart.nl/anonieme-ov-chipkaart-reishistorie)),
  so deep scrapes return nothing anyway.
- The dashboard's export/import is the right long-term archive: scrape occasionally,
  export, and let the local archive grow past 18 months instead of re-scraping.

## Resulting scraper policy (implemented in content_script.js)

1. `HISTORY_YEARS = 2` — covers the 18-month retention with margin; was 5, which fired
   up to ~120 rapid serial requests per card for data that cannot exist.
2. `CHUNK_DELAY_MS = 1500` between 30-day chunks — human-paced traffic instead of a burst.
3. **Abort on HTTP 471** mid-scrape: stop immediately (all cards), keep the partial
   result, tell the user to reload for a fresh session. Never retry through a WAF block.
