import requests
import xml.etree.ElementTree as ET

url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
params = {
    'db': 'biosample',
    'term': 'Antibiogram[Table]',
    'retmax': 50,
    'retmode': 'xml'
}

r = requests.get(url, params=params)
root = ET.fromstring(r.content)
uids = [id_el.text for id_el in root.findall(".//IdList/Id") if id_el.text]
print(f"UIDs count: {len(uids)}")

# Convert UIDs to accessions & inspect XML tables
summary_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
for uid in uids[:10]:
    r = requests.get(summary_url, params={'db': 'biosample', 'id': uid, 'retmode': 'xml'})
    xml_text = r.text
    b_root = ET.fromstring(r.content)
    acc = b_root.find(".//BioSample").attrib.get("accession", uid) if b_root.find(".//BioSample") is not None else uid
    tables = b_root.findall(".//Table")
    print(f"BioSample {acc} (UID {uid}): found {len(tables)} <Table> elements")
    for t in tables:
        print("  Table class:", t.attrib.get('class'))
        print("  Table xml snippet:", ET.tostring(t, encoding='unicode')[:300])
