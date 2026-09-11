import requests
import xml.etree.ElementTree as ET

url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
terms = [
    'Antibiogram.1.0[Package]',
    'Antibiogram[Table]',
    'Antibiogram[All Fields] AND "Escherichia coli"[Organism]',
    'Antibiogram[All Fields] AND "Escherichia coli/Shigella"[Organism]',
    'antibiogram[Properties]'
]

for t in terms:
    r = requests.get(url, params={'db': 'biosample', 'term': t, 'retmode': 'xml'})
    root = ET.fromstring(r.content)
    cnt = root.findtext('Count', '0')
    print(f"{t} -> Count: {cnt}")
