# OVerview
Experimental stastics anaylsis of personal public transport usage as provided by the dutch OV system

# How-to
Here is how to get the results. These steps are done in firefox. for Chrome may be a bit different

1. Go to [mijn-ov-reishistorie](https://www.ov-chipkaart.nl/nl/mijn-ov-chip/mijn-ov-reishistorie) and login. Then go to "declaratieoverzicht".

2. now open developer console in your browser and go to the network branch and clear it so you have nothing in the overview.

3. click on `download csv` of your history and you will see one curl request to `generateDocument`. Right click and press `Copy as cURL`

4. go to [curlconverter](https://curlconverter.com/) and convert it to a python request. It is supposed to be run in only javascript on the client so secure. If you dont trust them you can run it locally or remove the auth token and add it back later.

5. Copy the content over to `curl_request.py` and replace the mentioned comment there. 

Now you can already run it and check if it outputs a .csv

6. in the request change

```
    'dateFilter': {
        'end': '2025-02-25',
        'start': '2025-01-26',
    },
```

to a start date far before like a year

# How to interpret the data

It is a bit of a mess so i will come back to that later. For now just look at it with excel
