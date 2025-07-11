import requests
import base64
import json

## ------

import requests

cookies = {
    'stickyness': '1745324817.112.30.4183|ecde8e6329424a686d7ce003e68b121d',
    '__Host-next-auth.csrf-token': 'c4b7f01a956039d77bf8df780c9699f882fb822ddc55438f5ee22e31219442e5%7C74a78b99bc32c8e8d3023c19ae1f442bdd0849ca0bd05c732f3e0583792aa09c',
    '__Secure-next-auth.callback-url': 'https%3A%2F%2Fwww.ov-chipkaart.nl%2Fmijn-ov-chip%2Fmijn-ov-reishistorie',
    'rbzid': '1aZDqDe2kukT1oEaWoUmfCobSC46q9GF/4KAnlBDrGvtnUi+xgN3DrysBv/DWQWFxlrhruFTvMTyCOtt8Mv0bSje/50b6nxPTQGTENZ2/V87b7dBellikyAxFUAMAJdLxIXRiagT4SmYufFlIl6JoCfRMu4OfraL6GbvPkZsa6Vf9xWlIP1em0uD/DkAQNjua+CAxImik6ScvTx8F3IrJP3Gmd5IbvW0WZ6QNj85p5w=',
    'rbzsessionid': '9c32a4a575d34b73928e81a42e769cba',
    '__Secure-next-auth.session-token': 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..nx2eMIsGxKs9Ag3w.afbYOSqWk1sG9tAFoYS3Ezbx0kADDkVdvfKZn0YhP0twHFE6Xa6qW2C4XXEk5MymU9y9rqq25IvJ4g1iVbbK_GSDZ3vYc-mQmS21FpBCv8VlKoFvVpox7loiiXszl0ptFZdEmu6blzAUIdUPiHvzWqyK0asnPvbiRG8GHY_huEb_3DL9ZyRdAXlkeerqiDyBV1ldhk1bX2b_3nNmfQMyXS93hldf48xV-aRvkt5ol3pxt-SnKz5aYXb5Nj_iZwBXwAOc1vwDR5FXuIX-5Lm3h0hxWCitr7QGs0phzieOxnJLOiYzvpvPTajcxtHeOvbSSGqC0rrNQS0X1OxVsSFtbmWCf4oF_SNf7n6BE-Xs8O2CEdu-QIJdDjR8M4a2sfZx1o-JYD4csIWvwFNE1GrLY90p9cE2p6iZJn06UnqzLynnnHmSygUQ24M8uu9oIqFxO-MkvjALtX_OZ5_15BLhm77sayXRaGu5Kz_pk6IUnsLZCyGNP923o4X4kklp32lv3izWWUNP20iyXNXPZNs9VAoOEcR1GEJHbhWGf5RLbV73EtsE_yN5Pbmc9WYGC8dzhApxRPW9EJEACpZf3A0xLTKJo6y_o688NGJbiy1QUjEnIhYQ4xQBtcV-9_J1iUVTZtOQEJZzgg_ktSOx2dbb_zeZFubF_u49ZZHlsg_cZuaMQfGDEGTuA7T5A09Xoav6BZ4lxEjnsQNs8VEKVJjXRYKINcSR8JRIo3Kfe3xEJV75MJjypSKKyrPa3ELIQxjjpue5WjHHMFwoUzZ6Q9o8SpqZD-qA-TYmfr9n7s0uxvFEAhZXXc2AhSfGz2pxfY-UwEf6USCZ6t-QxAd-vwMSgMUg-CfmU2ckjbYsB3h3Qdrawkhe-QNXrzecMt_Ix4brQsho3GLimookxztp58wVKcKGvxh7g2OU2aIfi2Ymlz4RR-7lX-J3DoRhSJkOLq_fwQ-2fel8dInXRvRT5Ji17opRRzoGv9xdFM9hRsBFUPiUBuSGnq1-KShsDF_9G76Mg4ARynCuNe20OVXPln30OZIbVSYQDW_vLvy6U8uz6ekC_6UCr-XitolZcEcRMXUAap7pt5D7U5MlGlTliedD9f2IdZJL6yX0sk7jZHbxN_roy-C7GUZIsFmsG2C1YsOjtIsHYCYziwfFbdPcWQyeOUjSeYyAvtzO-Mgqjzr8AlMVVW7_UFDdu6IWqXfy5_l3Frv-O_GxnDNUgJXf9_xIXKiXbrgZ7DouAX2fmfXJi5zAUCx9B9vW31lR7RQHtnk2X8epqjvEHPGNd6WiwQK20Mt1kH1n2icz4FvUhIAOi-dLnZSpYrsmRV5cB0LxbYYYvFVrT2q9FsYseixg1wgaoPFF5g41ojAJFylULeN7DheZDpnvkruYZwbgKiTAu33ljksp9FolnOWDOf8uHGuCmkfYEBBs3zlKjQltCxgHUOtr3ZdqRgu9miHDzu3TQQD4yZLVU6FWSHiwnwe34c5E-5OQjp49eBAtHMOXc5KEmwYN3qVjD0C0S8_2ljZIP-2OVC321Tv9heCfspR__RfJ_hweznknmw2dRCNQGp7t38ez1PRdX-kd7MO7FFr5UiWZlBcKSgd1jTWwuGGDsRPKbaCQCapWXYsqYo_EexXl-PMCcSFLKFzuYnvLV4iTz_FQWznMEwCSXzTPzg2Fy9HQcDO_vLdi_xpbw8oarsDnWMyUaNKTYCVE_Hsr-pCI0dFWhg1H3prTU4QhMHZntW35KMgHSS1EgN2aMAEgoA.A0wSk-vBUOylXieOObXO5g',
}

headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'nl-nl',
    'authorization': 'Bearer eyJ4NXQiOiJaVGcwWVRWalpUVTVPR0k0WldabE9EWmlZekU1WVRsa1pHVmtOV1EyWkRVMU9HUTRZV1EwT1dKbFlXSTFOVFJsWW1FMU1UaGtZMkUyT1RFM00yVXhOUSIsImtpZCI6IlpUZzBZVFZqWlRVNU9HSTRaV1psT0RaaVl6RTVZVGxrWkdWa05XUTJaRFUxT0dRNFlXUTBPV0psWVdJMU5UUmxZbUUxTVRoa1kyRTJPVEUzTTJVeE5RX1JTMjU2IiwiYWxnIjoiUlMyNTYifQ.eyJhdF9oYXNoIjoic1g0aWF2NnZZcFVqQzlZWnB1cUk2USIsImF1ZCI6IkhYcF9ocjR0Q3hiYmRpUDFfMFJSb2V5aV9OUWEiLCJjX2hhc2giOiJUNThEaWtLSTBCYUd4VUVxMVo5cGhBIiwic3ViIjoiam9sbGVyMTM0IiwibmJmIjoxNzQ1MzI1MDM0LCJhenAiOiJIWHBfaHI0dEN4YmJkaVAxXzBSUm9leWlfTlFhIiwiYW1yIjpbIkJhc2ljQXV0aGVudGljYXRvciIsIkVtYWlsT1RQIl0sImlzcyI6Imh0dHBzOlwvXC9sb2dpbi5vdi1jaGlwa2FhcnQubmxcL29hdXRoMlwvdG9rZW4iLCJleHAiOjE3NDUzMjg2MzQsImlhdCI6MTc0NTMyNTAzNCwiZW1haWwiOiJqYXNwZXItendAaG90bWFpbC5ubCIsInNpZCI6IjI5NTM4NGM2LTE1MzUtNDVmNy05ZjZlLTQ0MmNjNTAzYTg4MyJ9.T9OBOa0nVE0mxcfbvUPDQ_GRv4TGGUSj2M-oqQW1C2n49a4hfhogp4edzoPw0xjuIttEb02EVYN1_w3FnOMOSDmbWojnnmByuN0usuH12VmZGonRpCxg735VvEx5370iB6tDYK-SRRDaxZCbslZaUamlFqWwSxOXEVm_1rtRcrm2T1clo76PqXpGSQIugDqICssZ366cNAmj9PvhTXt4ysgnYprlL3hDaE-Id6U-TV_ARQHVBbnNIkVwiq1ZnWemSb4pITJybx1ym5CudYAiUmrniOUL-wHET9z59dqpCgJtAbv5bMQq8Q9nZGuZB3RnEB2hX77jobhJa3-cQepaow',
    'content-type': 'application/json',
    # 'cookie': 'stickyness=1745324817.112.30.4183|ecde8e6329424a686d7ce003e68b121d; __Host-next-auth.csrf-token=c4b7f01a956039d77bf8df780c9699f882fb822ddc55438f5ee22e31219442e5%7C74a78b99bc32c8e8d3023c19ae1f442bdd0849ca0bd05c732f3e0583792aa09c; __Secure-next-auth.callback-url=https%3A%2F%2Fwww.ov-chipkaart.nl%2Fmijn-ov-chip%2Fmijn-ov-reishistorie; rbzid=1aZDqDe2kukT1oEaWoUmfCobSC46q9GF/4KAnlBDrGvtnUi+xgN3DrysBv/DWQWFxlrhruFTvMTyCOtt8Mv0bSje/50b6nxPTQGTENZ2/V87b7dBellikyAxFUAMAJdLxIXRiagT4SmYufFlIl6JoCfRMu4OfraL6GbvPkZsa6Vf9xWlIP1em0uD/DkAQNjua+CAxImik6ScvTx8F3IrJP3Gmd5IbvW0WZ6QNj85p5w=; rbzsessionid=9c32a4a575d34b73928e81a42e769cba; __Secure-next-auth.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..nx2eMIsGxKs9Ag3w.afbYOSqWk1sG9tAFoYS3Ezbx0kADDkVdvfKZn0YhP0twHFE6Xa6qW2C4XXEk5MymU9y9rqq25IvJ4g1iVbbK_GSDZ3vYc-mQmS21FpBCv8VlKoFvVpox7loiiXszl0ptFZdEmu6blzAUIdUPiHvzWqyK0asnPvbiRG8GHY_huEb_3DL9ZyRdAXlkeerqiDyBV1ldhk1bX2b_3nNmfQMyXS93hldf48xV-aRvkt5ol3pxt-SnKz5aYXb5Nj_iZwBXwAOc1vwDR5FXuIX-5Lm3h0hxWCitr7QGs0phzieOxnJLOiYzvpvPTajcxtHeOvbSSGqC0rrNQS0X1OxVsSFtbmWCf4oF_SNf7n6BE-Xs8O2CEdu-QIJdDjR8M4a2sfZx1o-JYD4csIWvwFNE1GrLY90p9cE2p6iZJn06UnqzLynnnHmSygUQ24M8uu9oIqFxO-MkvjALtX_OZ5_15BLhm77sayXRaGu5Kz_pk6IUnsLZCyGNP923o4X4kklp32lv3izWWUNP20iyXNXPZNs9VAoOEcR1GEJHbhWGf5RLbV73EtsE_yN5Pbmc9WYGC8dzhApxRPW9EJEACpZf3A0xLTKJo6y_o688NGJbiy1QUjEnIhYQ4xQBtcV-9_J1iUVTZtOQEJZzgg_ktSOx2dbb_zeZFubF_u49ZZHlsg_cZuaMQfGDEGTuA7T5A09Xoav6BZ4lxEjnsQNs8VEKVJjXRYKINcSR8JRIo3Kfe3xEJV75MJjypSKKyrPa3ELIQxjjpue5WjHHMFwoUzZ6Q9o8SpqZD-qA-TYmfr9n7s0uxvFEAhZXXc2AhSfGz2pxfY-UwEf6USCZ6t-QxAd-vwMSgMUg-CfmU2ckjbYsB3h3Qdrawkhe-QNXrzecMt_Ix4brQsho3GLimookxztp58wVKcKGvxh7g2OU2aIfi2Ymlz4RR-7lX-J3DoRhSJkOLq_fwQ-2fel8dInXRvRT5Ji17opRRzoGv9xdFM9hRsBFUPiUBuSGnq1-KShsDF_9G76Mg4ARynCuNe20OVXPln30OZIbVSYQDW_vLvy6U8uz6ekC_6UCr-XitolZcEcRMXUAap7pt5D7U5MlGlTliedD9f2IdZJL6yX0sk7jZHbxN_roy-C7GUZIsFmsG2C1YsOjtIsHYCYziwfFbdPcWQyeOUjSeYyAvtzO-Mgqjzr8AlMVVW7_UFDdu6IWqXfy5_l3Frv-O_GxnDNUgJXf9_xIXKiXbrgZ7DouAX2fmfXJi5zAUCx9B9vW31lR7RQHtnk2X8epqjvEHPGNd6WiwQK20Mt1kH1n2icz4FvUhIAOi-dLnZSpYrsmRV5cB0LxbYYYvFVrT2q9FsYseixg1wgaoPFF5g41ojAJFylULeN7DheZDpnvkruYZwbgKiTAu33ljksp9FolnOWDOf8uHGuCmkfYEBBs3zlKjQltCxgHUOtr3ZdqRgu9miHDzu3TQQD4yZLVU6FWSHiwnwe34c5E-5OQjp49eBAtHMOXc5KEmwYN3qVjD0C0S8_2ljZIP-2OVC321Tv9heCfspR__RfJ_hweznknmw2dRCNQGp7t38ez1PRdX-kd7MO7FFr5UiWZlBcKSgd1jTWwuGGDsRPKbaCQCapWXYsqYo_EexXl-PMCcSFLKFzuYnvLV4iTz_FQWznMEwCSXzTPzg2Fy9HQcDO_vLdi_xpbw8oarsDnWMyUaNKTYCVE_Hsr-pCI0dFWhg1H3prTU4QhMHZntW35KMgHSS1EgN2aMAEgoA.A0wSk-vBUOylXieOObXO5g',
    'origin': 'https://www.ov-chipkaart.nl',
    'priority': 'u=1, i',
    'referer': 'https://www.ov-chipkaart.nl/nl/mijn-ov-chip/mijn-ov-reishistorie',
    'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

json_data = {
    'mediumId': '3528050050719915',
    'expiryDate': '2028-08-09',
    'documentFormat': 'COMMA_SEPARATED_VALUE',
    'dateFilter': {
        'end': '2025-03-31',
        'start': '2024-03-01',
    },
    'transactionKindFilter': None,
    'selectedTransactions': [
        {
            'id': 536,
            'isSelected': True,
        },
        {
            'id': 535,
            'isSelected': True,
        },
        {
            'id': 534,
            'isSelected': True,
        },
        {
            'id': 532,
            'isSelected': True,
        },
        {
            'id': 531,
            'isSelected': True,
        },
        {
            'id': 530,
            'isSelected': True,
        },
        {
            'id': 528,
            'isSelected': True,
        },
        {
            'id': 527,
            'isSelected': True,
        },
        {
            'id': 526,
            'isSelected': True,
        },
        {
            'id': 525,
            'isSelected': True,
        },
        {
            'id': 523,
            'isSelected': True,
        },
        {
            'id': 522,
            'isSelected': True,
        },
        {
            'id': 521,
            'isSelected': True,
        },
        {
            'id': 520,
            'isSelected': True,
        },
        {
            'id': 519,
            'isSelected': True,
        },
        {
            'id': 518,
            'isSelected': True,
        },
        {
            'id': 517,
            'isSelected': True,
        },
        {
            'id': 516,
            'isSelected': True,
        },
        {
            'id': 515,
            'isSelected': True,
        },
        {
            'id': 514,
            'isSelected': True,
        },
        {
            'id': 513,
            'isSelected': True,
        },
        {
            'id': 512,
            'isSelected': True,
        },
        {
            'id': 511,
            'isSelected': True,
        },
        {
            'id': 509,
            'isSelected': True,
        },
        {
            'id': 507,
            'isSelected': True,
        },
        {
            'id': 505,
            'isSelected': True,
        },
        {
            'id': 503,
            'isSelected': True,
        },
        {
            'id': 502,
            'isSelected': True,
        },
        {
            'id': 501,
            'isSelected': True,
        },
        {
            'id': 500,
            'isSelected': True,
        },
        {
            'id': 499,
            'isSelected': True,
        },
        {
            'id': 498,
            'isSelected': True,
        },
        {
            'id': 496,
            'isSelected': True,
        },
        {
            'id': 495,
            'isSelected': True,
        },
        {
            'id': 493,
            'isSelected': True,
        },
    ],
}



# Note: json_data will not be serialized by requests
# exactly as it was in the original request.
#data = '{"mediumId":"3528050050719915","expiryDate":"2028-08-09","documentFormat":"COMMA_SEPARATED_VALUE","dateFilter":{"end":"2025-03-31","start":"2025-03-01"},"transactionKindFilter":null,"selectedTransactions":[{"id":536,"isSelected":true},{"id":535,"isSelected":true},{"id":534,"isSelected":true},{"id":532,"isSelected":true},{"id":531,"isSelected":true},{"id":530,"isSelected":true},{"id":528,"isSelected":true},{"id":527,"isSelected":true},{"id":526,"isSelected":true},{"id":525,"isSelected":true},{"id":523,"isSelected":true},{"id":522,"isSelected":true},{"id":521,"isSelected":true},{"id":520,"isSelected":true},{"id":519,"isSelected":true},{"id":518,"isSelected":true},{"id":517,"isSelected":true},{"id":516,"isSelected":true},{"id":515,"isSelected":true},{"id":514,"isSelected":true},{"id":513,"isSelected":true},{"id":512,"isSelected":true},{"id":511,"isSelected":true},{"id":509,"isSelected":true},{"id":507,"isSelected":true},{"id":505,"isSelected":true},{"id":503,"isSelected":true},{"id":502,"isSelected":true},{"id":501,"isSelected":true},{"id":500,"isSelected":true},{"id":499,"isSelected":true},{"id":498,"isSelected":true},{"id":496,"isSelected":true},{"id":495,"isSelected":true},{"id":493,"isSelected":true}]}'
#response = requests.post(
#    'https://www.ov-chipkaart.nl/backend/moc/cardtravelhistory/generatedocument',
#    cookies=cookies,
#    headers=headers,
#    data=data,
#)
## ------

def generate_selected_ids_from_existing(json_data):
    """
    Generates a list of transaction IDs from 1 to the highest ID in `json_data`,
    each with 'isSelected' set to True.

    :param json_data: The JSON object containing 'selectedTransactions'.
    :return: A list of dictionaries with 'id' and 'isSelected' set to True for all IDs.
    """
    # Extract the list of selected transactions
    selected_transactions = json_data['selectedTransactions']
    
    # Find the highest ID from the selected transactions
    max_id = max([transaction['id'] for transaction in selected_transactions])

    # Generate all IDs from 1 to the highest ID with isSelected set to True
    all_selected_ids = [{'id': i, 'isSelected': True} for i in range(1, max_id + 1)]
    
    json_data['selectedTransactions'] = all_selected_ids
    
    return json_data
    
json_data = generate_selected_ids_from_existing(json_data) #Set all selections to true


response = requests.post(
    'https://www.ov-chipkaart.nl/backend/moc/cardtravelhistory/generatedocument',
    cookies=cookies,
    headers=headers,
    json=json_data,
)


#response is in json
response_json = json.loads(response.content)
encoded_content = response_json["document"]["content"]

#File is encoded in base64
decoded_bytes = base64.b64decode(encoded_content)
decoded_text = decoded_bytes.decode("utf-8")

#Save file to csv
with open("output.csv", "w", encoding="utf-8") as file:
    file.write(decoded_text)

print("CSV file successfully created: output.csv")
