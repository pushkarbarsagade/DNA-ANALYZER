import requests
import xml.etree.ElementTree as ET

uids = ['62387535', '62387534', '62387533']
url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

for uid in uids:
    r = requests.get(url, params={'db': 'biosample', 'id': uid, 'retmode': 'xml'})
    root = ET.fromstring(r.content)
    acc = root.find(".//BioSample").attrib.get("accession", uid)
    tables = root.findall(".//Table")
    print(f"UID {uid} (Acc {acc}): found {len(tables)} <Table> elements")
    if tables:
        for t in tables:
            print("  Table class:", t.attrib.get('class'))
            print("  Table XML snippet:", ET.tostring(t, encoding='unicode')[:500])
    else:
        # print all XML text snippet to see where CLSI/EUCAST/antibiogram is
        print("  XML snippet:", r.text[:2000])
