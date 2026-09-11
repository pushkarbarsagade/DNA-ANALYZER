import requests
import xml.etree.ElementTree as ET

# Search BioSample for any XML containing "Antibiogram" or AST tables
# Let's test a few search queries in Entrez
queries = [
    'antibiogram[attribute]',
    'antibiogram[title]',
    'antibiogram[all fields]',
    'antibiogram.1.0[all fields]',
    'CLSI[all fields]',
    'EUCAST[all fields]',
    'mic[attribute]'
]

for q in queries:
    r = requests.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params={
        'db': 'biosample',
        'term': q,
        'retmax': 5,
        'retmode': 'xml'
    })
    root = ET.fromstring(r.content)
    cnt = root.findtext("Count", "0")
    uids = [el.text for el in root.findall(".//IdList/Id") if el.text]
    print(f"Query '{q}': count={cnt}, uids={uids[:3]}")
