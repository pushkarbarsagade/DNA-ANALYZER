import requests
import xml.etree.ElementTree as ET

# Check candidates from find_ast_pdg_intersection
# Let's check SAMN13050467, SAMN13050523, SAMN13178622, SAMN13178654
candidates = ['SAMN13050467', 'SAMN13050523', 'SAMN13178622', 'SAMN13178654', 'SAMN12658823', 'SAMN12658824']
url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

for acc in candidates:
    r = requests.get(url, params={'db': 'biosample', 'id': acc, 'retmode': 'xml'})
    root = ET.fromstring(r.content)
    rows = root.findall('.//Row')
    defined = [row for row in rows if len(row.findall('Cell')) > 1 and row.findall('Cell')[1].text and row.findall('Cell')[1].text.strip().lower() != 'not defined']
    print(f"BioSample {acc}: total AST rows = {len(rows)}, defined AST rows = {len(defined)}")
    if defined:
        for d in defined[:3]:
            print("  Defined sample:", [c.text for c in d.findall('Cell')[:3]])
