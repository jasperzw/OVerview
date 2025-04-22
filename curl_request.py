import requests
import base64
import json

## ------

## PASTE HERE YOUR CURL EXPORT

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
