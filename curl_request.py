import requests
import base64
import json

## ------

# PASTE HERE YOUR CURL REQUEST EXPORT

## ------

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
