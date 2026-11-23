from pathlib import Path
import base64
import json
import re

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'
DIST = ROOT
DIST.mkdir(exist_ok=True)

asset_files = {name: name + '.webp' for name in ['logo', 'products', 'cover', 'case-header', 'case-freeze', 'case-medical', 'case-export', 'detail-series']}
asset_files.update({f'home-poster-{i:02d}': f'home-poster-{i:02d}.jpg' for i in range(1, 5)})

def encode_image_file(path):
    mime = {'.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.png':'image/png', '.gif':'image/gif', '.svg':'image/svg+xml'}.get(path.suffix.lower())
    if not mime:
        raise ValueError('Unsupported image format: ' + str(path))
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode()

def encode_asset(filename):
    return encode_image_file(SRC / 'assets' / filename)

# Preserve the four supplied JPEGs byte-for-byte in the hosted/downloadable page.
assets = {name: encode_asset(filename) for name, filename in asset_files.items()}
contact_data = json.loads((SRC / 'contact-data.json').read_text(encoding='utf-8'))

def add_contact_asset(relative_path, key):
    path = (SRC / relative_path).resolve()
    if not path.is_relative_to(SRC.resolve()) or not path.is_file():
        raise ValueError('Contact image must be an existing file inside src/: ' + relative_path)
    assets[key] = encode_image_file(path)
    return key

for service in contact_data.get('services', []):
    if service.get('image'):
        service['assetKey'] = add_contact_asset(service['image'], 'contact-service-' + service['id'])
if contact_data.get('contact', {}).get('qrImage'):
    contact_data['contact']['qrAssetKey'] = add_contact_asset(contact_data['contact']['qrImage'], 'contact-qr')
data = json.loads((SRC / 'catalog-data.json').read_text(encoding='utf-8'))
for product in data['products']:
    if product['type'] == 'placeholder':
        product['name'] = next(c['name'] for m in data['modules'] for c in m['categories'] if c['id'] == product['category'])

app = (SRC / 'app.html').read_text(encoding='utf-8')
for token, name in [('{{COMPANY_HTML}}', 'company.html'), ('{{CONTACT_HTML}}', 'contact.html'), ('{{CONTACT_DIALOG_HTML}}', 'contact-dialog.html')]:
    app = app.replace(token, (SRC / name).read_text(encoding='utf-8'))
device = (SRC / 'device.html').read_text(encoding='utf-8').replace('{{APP}}', app)
markup = '<div id="weitai-redesign" class="prototype-stage">\n' + device + '\n</div>'
css = '\n'.join((SRC / name).read_text(encoding='utf-8') for name in ['app.css', 'company.css', 'contact.css', 'device.css', 'cases.css'])

# Encode each image once. Declarative markers keep both previews on the same layout.
for asset in ['logo','products','cover']:
    token = '{{ASSET_' + asset.upper() + '}}'
    markup = markup.replace('src="' + token + '"', 'data-asset="' + asset + '"')
    css = re.sub(r'url\([\'\"]?' + re.escape(token) + r'[\'\"]?\)', 'var(--' + asset + '-image)', css)

script_source = (SRC / 'app.js').read_text(encoding='utf-8')
catalog_json = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
contact_json = json.dumps(contact_data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')

def build_script(asset_data):
    return script_source.replace('{{CATALOG_DATA}}', catalog_json).replace('{{CONTACT_DATA}}', contact_json).replace('{{ASSET_DATA}}', json.dumps(asset_data, separators=(',', ':')))

script = build_script(assets)
icon_json = (SRC / 'icons.json').read_text(encoding='utf-8')
icon_shim = '''(() => {
 const icons = ICON_JSON;
 const ns = 'http://www.w3.org/2000/svg';
 function createIcons(options={}) {
   document.querySelectorAll('#weitai-redesign [data-lucide]').forEach(node=>{
     if(node.tagName.toLowerCase()==='svg')return;
     const name=node.getAttribute('data-lucide').split('-').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('');
     const definition=icons[name]; if(!definition)return;
     const svg=document.createElementNS(ns,'svg');
     for(const [key,value] of Object.entries({width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round',...options.attrs})) svg.setAttribute(key,value);
     for(const attribute of node.attributes) if(attribute.name!=='class') svg.setAttribute(attribute.name,attribute.value);
     svg.setAttribute('class','lucide '+(node.className||''));
     const children=definition;
     for(const [tag,attributes] of children){const child=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))child.setAttribute(key,value);svg.appendChild(child);}
     node.replaceWith(svg);
   });
 }
 window.lucide={createIcons};
})();'''.replace('ICON_JSON',icon_json)

full = '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff"><link rel="icon" href="data:,"><title>微肽生物 · 产品电子册</title><style>html,body{margin:0;padding:0;background:#f3f6f8;}\n' + css + '</style></head><body>\n' + markup + '\n<script>' + icon_shim + '\n' + script + '</script>\n</body></html>\n'
assert not re.search(r'\{\{[A-Z_]+\}\}', full), 'Unresolved build token'
assert '<script src=' not in full and '<link rel="stylesheet"' not in full
(DIST / 'index.html').write_bytes(full.encode('utf-8'))

print('Generated:', DIST / 'index.html')
