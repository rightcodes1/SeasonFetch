"""Mocked UI regression check; run against local `npm run dev` with Python Playwright."""

import json
import os
import shutil

from playwright.sync_api import sync_playwright

A, B, C = 'a' * 40, 'b' * 40, 'c' * 40

def release(info_hash, index, title):
    return {'infoHash': info_hash, 'fileIdx': index, 'title': title,
            'magnet': f'magnet:?xt=urn%3Abtih%3A{info_hash}&so={index}&dn={title}',
            'rawMagnet': f'magnet:?xt=urn%3Abtih%3A{info_hash}&so={index}',
            'sizeBytes': 1024, 'sizeLabel': '1 KB', 'resolution': '1080p',
            'seeders': 2, 'provider': 'Mock provider'}

a, b, c = release(A, 1, 'Shared'), release(B, 0, 'Alternative'), release(C, 2, 'SecondSeason')
series = {'id':'tt1234567', 'imdbId':'tt1234567', 'title':'Mock Series', 'year':'2020',
          'seasons':2, 'seasonNumbers':[1,2], 'type':'Drama', 'rating':'8.0', 'synopsis':'Mock data', 'genres':[]}

def route_handler(route):
    url = route.request.url
    if '/api/cinemeta/search' in url:
        data = {'results':[series]}
    elif '/api/cinemeta/series/' in url:
        data = {'series': series, 'episodes': {'1':[{'number':10,'title':'Ten'}, {'number':2,'title':'Two'}, {'number':11,'title':'Unavailable'}], '2':[{'number':1,'title':'Next season'}]}}
    elif '/api/torrentio/season/' in url:
        if '/2?' in url:
            results = [{'episode':1,'selected':c,'status':'selected','sources':[c]}]
        else:
            results = [{'episode':10,'selected':a,'status':'selected','sources':[a]},
                       {'episode':2,'selected':a,'status':'selected','sources':[a,b]},
                       {'episode':11,'selected':None,'status':'unavailable','sources':[]}]
        data = {'status':'live','results':results, 'integrity':None}
    else:
        data = {}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

with sync_playwright() as p:
    chromium = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
    browser = p.chromium.launch(executable_path=chromium, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1280,'height':900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/**', route_handler)
    page.add_init_script("""window.__copied = ''; window.__denyCopy = false;
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async text => {
        if (window.__denyCopy) throw new Error('Permission denied'); window.__copied = text;
      }}});
      document.execCommand = () => false;""")
    page.goto(os.environ.get('APP_URL', 'http://127.0.0.1:3000/'), wait_until='networkidle')
    page.get_by_role('button', name='Search', exact=True).click()
    page.get_by_role('button', name='Mock Series').first.click()
    page.get_by_role('button', name='Check sources', exact=True).click()
    page.get_by_role('button', name='Add available to tray').wait_for(state='visible')
    page.wait_for_function("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Add available to tray') && !b.disabled)")
    page.get_by_role('button', name='Add available to tray').click()
    print('AFTER_ADD', page.locator('.download-tray').inner_text())
    assert '1 unique download' in page.locator('.download-tray').inner_text().lower()
    assert '02' in page.locator('.download-tray').inner_text() and '10' in page.locator('.download-tray').inner_text()
    refs = page.locator('.download-tray-references').inner_text()
    assert refs.index('S01E02') < refs.index('S01E10')
    page.locator('.download-tray').get_by_role('button', name='Remove Shared from download tray').click()
    assert '0 unique downloads' in page.locator('.download-tray').inner_text().lower()
    page.get_by_role('button', name='Add available to tray').click()
    page.get_by_role('button', name='E02 Two').click()
    details = page.locator('.episode-group').filter(has=page.get_by_role('button', name='E02 Two'))
    assert details.get_by_role('link', name='Open magnet', exact=True).first.get_attribute('href') == a['magnet']
    stremio_a = f'http://127.0.0.1:11470/{A}/1?external=1&download=1'
    assert details.get_by_role('link', name='Open Stremio download').get_attribute('href') == stremio_a
    details.get_by_role('button', name='Copy magnet with trackers').click()
    assert page.evaluate('window.__copied') == a['magnet']
    details.get_by_role('button', name='Copy raw magnet').click()
    assert page.evaluate('window.__copied') == a['rawMagnet']
    details.get_by_role('button', name='Copy Stremio link').click()
    assert page.evaluate('window.__copied') == stremio_a
    with page.expect_download() as download_info:
        page.get_by_role('button', name='Download .txt').click()
    assert open(download_info.value.path(), encoding='utf8').read() == a['magnet'] + '\n' + a['magnet'] + '\n'
    page.locator('.release-candidate').filter(has_text='Alternative').get_by_role('button',name='Use this release').click()
    print('AFTER_OVERRIDE', page.locator('.download-tray').inner_text())
    assert '2 unique downloads' in page.locator('.download-tray').inner_text().lower()
    assert details.get_by_role('link', name='Open magnet', exact=True).first.get_attribute('href') == b['magnet']
    assert details.get_by_role('link', name='Open Stremio download').get_attribute('href') == f'http://127.0.0.1:11470/{B}/0?external=1&download=1'
    page.get_by_role('button', name='Restore automatic recommendation').click()
    assert '1 unique download' in page.locator('.download-tray').inner_text().lower()
    assert details.get_by_role('link', name='Open magnet', exact=True).first.get_attribute('href') == a['magnet']
    assert details.get_by_role('link', name='Open Stremio download').get_attribute('href') == stremio_a
    page.locator('.download-tray').get_by_role('button',name='Copy magnets').click()
    copied = page.evaluate('window.__copied')
    assert copied == a['magnet'], (copied, a['magnet'])
    page.evaluate('window.__denyCopy = true')
    page.locator('.download-tray').get_by_role('button',name='Copy magnets').click()
    assert 'clipboard' in page.locator('.download-tray').inner_text().lower()
    page.get_by_label('Choose season').select_option('2')
    page.get_by_role('button', name='Check sources', exact=True).click()
    page.wait_for_function("[...document.querySelectorAll('button')].some(b => b.textContent.includes('Add available to tray') && !b.disabled)")
    page.get_by_role('button', name='Add available to tray').click()
    assert '2 unique downloads' in page.locator('.download-tray').inner_text().lower()
    page.locator('.download-tray').get_by_role('button',name='Clear tray').click()
    assert '0 unique downloads' in page.locator('.download-tray').inner_text().lower()
    assert page.locator('.download-tray').get_by_role('button',name='Copy magnets').is_disabled()
    assert not errors, errors
    for width in (1280, 1024, 900, 768, 375, 320):
        page.set_viewport_size({'width':width,'height':812})
        page.evaluate("document.activeElement?.blur(); window.scrollTo(0,0); document.querySelector('.app-shell').scrollLeft = 0")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'horizontal overflow at {width}px'
        bounds = page.evaluate("""[...document.querySelectorAll('.season-filter-controls select, .season-action-controls button')]
          .map(el => { const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(), g = el.parentElement.parentElement.getBoundingClientRect(); return {label: el.innerText || el.getAttribute('aria-label') || el.tagName, left: r.left, right: r.right, width: r.width, parent: [p.left, p.right], group: [g.left, g.right]}; })""")
        layout = page.evaluate("""({innerWidth, docWidth: document.documentElement.scrollWidth, shellScroll:[document.querySelector('.app-shell').scrollLeft,document.querySelector('.app-shell').scrollWidth,document.querySelector('.app-shell').clientWidth], ancestors: (() => { let e = document.querySelector('.season-toolbar'), out = []; while (e) { const r = e.getBoundingClientRect(), s = getComputedStyle(e); out.push({tag:e.tagName, class:e.className, bounds:[r.left,r.right], transform:s.transform, display:s.display, width:s.width}); if (e.classList.contains('app-shell')) break; e = e.parentElement; } return out; })()})""")
        assert all(item['left'] >= -1 and item['right'] <= width + 1 and item['width'] > 0 for item in bounds), f'season toolbar controls clipped at {width}px: {layout}, {bounds}'
    print('PASS: mocked search, numeric ordering, shared download removal, manual override/restore, individual magnet and Stremio links/copy, TXT export, clipboard success/failure, cross-season tray, empty state, and toolbar/mobile layout at 320–1280px')
    browser.close()
