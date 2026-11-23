(() => {
  const root = document.getElementById('weitai-redesign');
  if (!root) return;
  const DATA = {{CATALOG_DATA}};
  const CONTACT = {{CONTACT_DATA}};
  const ASSETS = {{ASSET_DATA}};
  const $ = id => root.querySelector('#' + id);
  const modules = DATA.modules.filter(m => m.id !== 'cases');
  const products = DATA.products;
  const state = { page:'catalog', module:modules[0].id, category:modules[0].categories[0]?.id || null, query:'', caseQuery:'', caseFilter:'case_featured', subcategory:'all', viewed:null, focusReturn:null, slide:0, playing:false };
  const memories = new Map();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const currentModule = () => modules.find(m => m.id === state.module);
  const categoryFilters = category => category?.filters?.length ? category.filters : [{id:'all',label:'全部'}];
  const matchesSubcategory = (product, filter) => filter.id==='all' || (filter.values || []).includes(product.subcategory) || (filter.productIds || []).includes(product.id);
  const productEfficacy = product => product.efficacySummary?.trim() || product.efficacy?.trim() || '产品功效介绍';
  const detailText = (value, separator='；') => Array.isArray(value) ? value.filter(Boolean).join(separator) || '待补充' : String(value || '').trim() || '待补充';
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const refreshIcons = () => { if (window.lucide?.createIcons) window.lucide.createIcons({attrs:{'stroke-width':1.7}}); };
  root.querySelectorAll('[data-asset]').forEach(el => { if (ASSETS[el.dataset.asset]) el.src = ASSETS[el.dataset.asset]; });
  root.style.setProperty('--products-image', `url("${ASSETS.products}")`);
  let toastTimer;
  let autoTimer;
  let scrollFrame;
  let copyReturnFocus;
  let contactReturnFocus;

  function toast(message) {
    clearTimeout(toastTimer); $('app-toast').textContent = message; $('app-toast').classList.add('show');
    toastTimer = setTimeout(() => $('app-toast').classList.remove('show'), 2300);
  }

  function showCopyFallback(text, title) {
    copyReturnFocus = document.activeElement;
    $('copy-sheet-title').textContent = title;
    $('copy-fallback').value = text;
    $('copy-sheet').hidden = false;
    setInert(true);
    $('product-detail').inert = true;
    $('contact-dialog').inert = true;
    $('copy-fallback').focus(); $('copy-fallback').select();
  }

  async function copyText(text, success='已复制', title='复制内容') {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text); toast(success);
    } catch { showCopyFallback(text,title); }
  }

  function closeCopySheet() {
    $('copy-sheet').hidden = true;
    $('product-detail').inert = false;
    $('contact-dialog').inert = false;
    setInert(!$('product-detail').hidden || !$('contact-dialog').hidden);
    if (copyReturnFocus?.isConnected) copyReturnFocus.focus({preventScroll:true});
  }

  function renderModules() {
    $('module-tabs').innerHTML = modules.map(m => `<button type="button" role="tab" id="module-${m.id}" data-module="${m.id}" aria-selected="${m.id===state.module}" aria-controls="catalog-results"><span class="module-icon">${icon(m.icon)}</span><span class="module-label">${escapeHTML(m.label)}</span></button>`).join('');
    $('catalog-results').setAttribute('aria-labelledby','module-' + state.module);
  }

  function renderCategories() {
    const mod = currentModule();
    $('catalog-body').classList.toggle('single-category',mod.categories.length <= 1);
    $('category-rail').hidden = mod.categories.length <= 1;
    const searching = !!state.query.trim();
    $('category-rail').innerHTML = mod.categories.map(c => {
      return `<button class="category-button ${c.id===state.category&&!searching?'active':''}" type="button" data-category="${c.id}" aria-label="${escapeHTML(c.name)}" ${c.id===state.category&&!searching?'aria-current="true"':''}><span class="category-name">${escapeHTML(c.name)}</span></button>`;
    }).join('');
  }

  function photoMarkup(product) {
    if (product.type === 'case' && ASSETS[product.assetKey]) return `<img src="${ASSETS[product.assetKey]}" alt="${escapeHTML(product.name)}示例产品图" draggable="false">`;
    if (!product.visual || product.type === 'placeholder') return `<span class="photo-placeholder-content">${icon('image')}<span>产品图待补充</span></span>`;
    return `<img class="quad-image quad-${product.visual}" src="${ASSETS.products}" alt="${escapeHTML(product.name)}概念包装示意图" loading="eager" draggable="false">`;
  }

  function codeLabel(product) { return product.type === 'case' ? '案例编号' : '配方编号'; }
  function shownCode(product) { return product.code || '待补充'; }

  function productCardMarkup(p) {
    return `<button class="product-card" type="button" data-product="${p.id}" aria-label="查看${escapeHTML(p.name)}，${escapeHTML(productEfficacy(p))}"><span class="product-photo ${!p.visual||p.type==='placeholder'?'image-placeholder':''}">${photoMarkup(p)}</span><span class="product-card-info"><span class="product-name">${escapeHTML(p.name)}</span><span class="product-efficacy">${escapeHTML(productEfficacy(p))}</span></span></button>`;
  }

  function productCoverMarkup(p) {
    if (p.coverAssetKey && ASSETS[p.coverAssetKey]) return `<img class="detail-cover-image" src="${ASSETS[p.coverAssetKey]}" alt="${escapeHTML(p.name)}横版封面" draggable="false">`;
    return `<div class="detail-cover-product">${photoMarkup(p)}</div><span class="detail-cover-note">包装示意</span>`;
  }

  const caseFilters = DATA.modules.find(m=>m.id==='cases')?.categories || [];

  function caseImageMarkup(item, className='case-grid-photo') {
    if (!ASSETS[item.assetKey]) return `<span class="${className} image-placeholder"><span class="photo-placeholder-content">${icon('image')}<span>案例图待补充</span></span></span>`;
    return `<span class="${className}${item.assetKey!=='case-featured'?' case-photo-wide':''}"><img src="${ASSETS[item.assetKey]}" alt="${escapeHTML(item.name)}示例产品图" loading="eager" draggable="false"></span>`;
  }

  function renderCaseTabs() {
    $('case-filter-tabs').innerHTML = caseFilters.map(tab => `<button type="button" id="filter-${tab.id}" role="tab" aria-controls="case-results" class="${state.caseFilter===tab.id?'active':''}" data-case-filter="${tab.id}" aria-selected="${state.caseFilter===tab.id}">${escapeHTML(tab.name)}</button>`).join('');
    $('case-results').setAttribute('aria-labelledby','filter-'+state.caseFilter);
  }

  function featuredCaseMarkup(item) {
    if (!item) return '';
    return `<button class="featured-case-card" type="button" data-product="${item.id}" aria-label="查看案例 ${escapeHTML(item.name)}">
      ${caseImageMarkup(item,'featured-case-photo')}
      <span class="featured-case-info">
        <span class="featured-case-brand">${escapeHTML(item.brand || item.name)}</span>
        <span class="featured-case-type">${escapeHTML(item.name)}</span>
        <span class="featured-case-description">${escapeHTML(item.caseHighlight || item.result || '')}</span>
      </span>
    </button>`;
  }

  function caseGridCardMarkup(item) {
    return `<button class="case-grid-card" type="button" data-product="${item.id}" aria-label="查看案例 ${escapeHTML(item.name)}">
      ${caseImageMarkup(item,'case-grid-photo')}
      <span class="case-grid-copy"><span class="case-grid-meta"><span class="case-grid-brand">${escapeHTML(item.brand || item.name)}</span><span class="case-tag">${escapeHTML(item.caseTag || item.subcategory || '案例')}</span></span>
      <span class="case-grid-desc">${escapeHTML(item.name)}</span></span>
    </button>`;
  }

  function renderCases() {
    const query = state.caseQuery.trim().toLocaleLowerCase();
    let list = products.filter(p=>p.type==='case');
    if (state.caseFilter && state.caseFilter !== 'case_featured') {
      const selected = caseFilters.find(tab=>tab.id===state.caseFilter);
      list = list.filter(p => p.category === state.caseFilter || p.subcategory === selected?.name);
    }
    if (query) list = list.filter(p => [p.name,p.en,p.code,p.brand,p.caseHighlight,p.result,p.caseTag,p.subcategory].some(v => (v||'').toLocaleLowerCase().includes(query)));
    const featured = list[0];
    const rest = list.slice(featured ? 1 : 0);
    renderCaseTabs();
    $('case-featured').innerHTML = featured ? featuredCaseMarkup(featured) : '';
    $('case-grid').innerHTML = rest.map(caseGridCardMarkup).join('');
    $('cases-empty').hidden = list.length !== 0;
    $('clear-case-search').hidden = !state.caseQuery;
    root.querySelector('.case-grid-section').hidden = rest.length === 0;
    root.querySelector('#case-featured').hidden = list.length === 0;
    $('case-count').textContent = `${list.length}个案例`;
    refreshIcons();
  }

  function renderProducts(resetScroll=false) {
    const mod = currentModule();
    const category = mod.categories.find(c => c.id===state.category) || mod.categories[0] || {id:null,name:mod.label};
    const filters = categoryFilters(category);
    if (!filters.some(filter => filter.id===state.subcategory)) state.subcategory=filters[0].id;
    const selectedFilter = filters.find(filter => filter.id===state.subcategory);
    // Empty display slots are retained in source data, but are not products or search results.
    const moduleProducts = products.filter(p => p.module===state.module && p.type==='product');
    const categoryProducts = moduleProducts.filter(p => p.category===category.id);
    let list;
    const query = state.query.trim().toLocaleLowerCase();
    if (query) {
      list = moduleProducts.filter(p => {
        const cat = mod.categories.find(c => c.id === p.category);
        const subtypeLabels = categoryFilters(cat).filter(filter => filter.id!=='all' && matchesSubcategory(p,filter)).map(filter => filter.label);
        return [p.name,p.en,p.code,cat?.name,p.subcategory,...subtypeLabels].some(value => (value || '').toLocaleLowerCase().includes(query));
      });
    } else {
      list = categoryProducts.filter(p => matchesSubcategory(p,selectedFilter));
    }
    $('category-title').textContent = query ? '搜索结果' : category.name;
    $('results-summary').hidden = !query;
    $('result-count').textContent = query ? `找到 ${list.length} 个产品` : '';
    $('filter-status').textContent = query ? `搜索结果，显示 ${list.length} 个产品` : `${category.name}，${selectedFilter.label}，显示 ${list.length} 个产品`;
    $('catalog-footnote').textContent = (state.module==='medical'?'示例目录':'示例产品') + ' · 正式资料待替换';
    $('catalog-footnote').hidden = list.length===0;
    $('reset-search').hidden = !query;
    $('clear-search').hidden = !state.query;
    $('catalog-filter-row').hidden = !!query;
    $('category-result-total').textContent = `${categoryProducts.length}款`;
    $('category-result-total').setAttribute('aria-label',`${category.name}共${categoryProducts.length}款产品`);
    const filterScroll = $('subfilters').dataset.category===category.id ? $('subfilters').scrollLeft : 0;
    $('subfilters').dataset.category=category.id;
    $('subfilters').setAttribute('aria-label',category.name+'细分类');
    $('subfilters').innerHTML = filters.map(filter => `<button type="button" data-subcategory="${escapeHTML(filter.id)}" class="${state.subcategory===filter.id?'active':''}" aria-pressed="${state.subcategory===filter.id}">${escapeHTML(filter.label)}</button>`).join('');
    $('subfilters').scrollLeft=filterScroll;
    const activeFilter=$('subfilters').querySelector('button.active');
    if (activeFilter && $('subfilters').clientWidth) {
      const left=activeFilter.offsetLeft;
      const right=left+activeFilter.offsetWidth;
      if (left<$('subfilters').scrollLeft) $('subfilters').scrollLeft=left;
      else if (right>$('subfilters').scrollLeft+$('subfilters').clientWidth) $('subfilters').scrollLeft=right-$('subfilters').clientWidth;
    }
    $('product-list').innerHTML = list.map(productCardMarkup).join('');
    $('empty-state').hidden = list.length!==0;
    $('empty-symbol').innerHTML = icon(query?'search-x':mod.icon);
    $('empty-title').textContent = query ? '没有找到相关产品' : (selectedFilter.id==='all' ? '该分类资料待补充' : '该细分类资料待补充');
    $('empty-description').textContent = query ? '试试产品名称、分类或配方编号。' : '后续在这里展示产品图片、名称和功效。';
    $('empty-reset').hidden = !query;
    if (resetScroll) $('catalog-results').scrollTop = 0;
    refreshIcons();
  }

  function selectModule(id) {
    if (id===state.module) return;
    memories.set(state.module,{category:state.category,query:state.query,subcategory:state.subcategory,scroll:$('catalog-results').scrollTop,rail:$('category-rail').scrollTop});
    const next = modules.find(m=>m.id===id);
    if (!next) return;
    state.module = id;
    const remembered = memories.get(id);
    state.category = next.categories.some(c=>c.id===remembered?.category) ? remembered.category : (next.categories[0]?.id || null);
    state.query = remembered?.query || '';
    state.subcategory = remembered?.subcategory || 'all';
    state.viewed = null;
    $('product-search').value=state.query;
    $('product-search').placeholder = '搜索产品 / 编号';
    $('search-label').textContent = '搜索产品名称或配方编号';
    renderModules(); renderCategories(); renderProducts();
    $('catalog-results').scrollTop = remembered?.scroll || 0;
    $('category-rail').scrollTop = remembered?.rail || 0;
    $('module-'+id).focus({preventScroll:true});
  }

  function selectCategory(id) {
    const category=currentModule().categories.find(c=>c.id===id);
    if (!category) return;
    state.category=id; state.query=''; state.subcategory=categoryFilters(category)[0].id; $('product-search').value='';
    renderCategories(); renderProducts(true);
    Array.from($('category-rail').querySelectorAll('button')).find(button=>button.dataset.category===id)?.focus({preventScroll:true});
  }

  function resetSearch() {
    state.query=''; $('product-search').value=''; renderCategories(); renderProducts(true); $('product-search').focus();
  }

  function setInert(value) {
    $('app-header').inert = value;
    $('app-main').inert = value;
    $('bottom-nav').inert = value;
  }

  function openProduct(id,trigger) {
    const p=products.find(p=>p.id===id); if (!p) return;
    const isCase=p.type==='case';
    state.viewed=p; state.focusReturn=trigger;
    $('detail-page-label').textContent=isCase?'案例详情':'产品详情';
    $('close-detail').setAttribute('aria-label',isCase?'返回品牌案例':'返回产品目录');
    $('detail-title').textContent=p.name;
    $('detail-name-meta').hidden=isCase;
    $('detail-name-label').hidden=isCase;
    $('detail-sample-label').hidden=isCase||!p.isSample;
    $('detail-sample-note').hidden=isCase||!p.isSample;
    $('detail-code-label').textContent=codeLabel(p);
    $('detail-code').textContent=shownCode(p);
    $('copy-code').hidden=!p.code;
    $('copy-code').setAttribute('aria-label','复制'+codeLabel(p));
    $('detail-photo').classList.toggle('image-placeholder',isCase && !ASSETS[p.assetKey]);
    $('detail-photo').classList.toggle('case-detail-photo',isCase);
    $('detail-photo').innerHTML=isCase?photoMarkup(p):productCoverMarkup(p);
    $('case-detail-meta').hidden=!isCase;
    $('case-detail-meta').innerHTML=isCase?`<p>${escapeHTML(p.brand)} · ${escapeHTML(p.caseTag)}</p><p>${escapeHTML(p.result)}</p><p class="case-detail-note">${escapeHTML(p.mockNote || '')}</p>`:'';
    root.querySelectorAll('[data-product-field]').forEach(field=>field.hidden=isCase);
    $('detail-efficacy').textContent=detailText(p.efficacy);
    $('detail-ingredients').textContent=detailText(p.ingredients,'、');
    $('detail-highlights').textContent=detailText(p.highlights,'\n');
    $('detail-produced').textContent=p.produced===true?'已生产':p.produced===false?'未生产':'待确认';
    $('detail-produced').dataset.status=p.produced===true?'yes':p.produced===false?'no':'unknown';
    $('detail-long-media').hidden=isCase;
    const longImage=$('detail-long-image');
    if(isCase) longImage.removeAttribute('src');
    else {
      longImage.src=ASSETS[p.longImageAssetKey] || ASSETS['detail-series'];
      longImage.alt=p.isSample ? '护肤产品系列摄影示例长图' : p.name+'产品详情长图';
    }
    $('product-detail').hidden=false; setInert(true); refreshIcons(); $('close-detail').focus();
    root.querySelector('.detail-content').scrollTop=0;
    pauseAutoplay();
  }

  function closeProduct() {
    if ($('product-detail').hidden) return;
    $('product-detail').hidden=true; setInert(false);
    if (state.focusReturn?.isConnected) state.focusReturn.focus({preventScroll:true});
  }

  const contactServices = (CONTACT.services || []).filter(item=>item.enabled!==false);
  const contactDetails = CONTACT.contact || {};
  const contactLines = value => (Array.isArray(value)?value:[value]).filter(Boolean).map(escapeHTML).join('<br>');

  function contactServiceMarkup(item) {
    if (item.assetKey && ASSETS[item.assetKey]) return `<span class="contact-service-photo"><img src="${ASSETS[item.assetKey]}" alt="${escapeHTML(item.title)}服务介绍" loading="lazy"></span>`;
    const tone=['blue','silver','mint'].includes(item.tone)?item.tone:'blue';
    const symbol=['flask-conical','package-check','layers','droplets','globe'].includes(item.icon)?item.icon:'layers';
    return `<span class="contact-service-art" data-tone="${tone}"><span class="contact-service-copy"><span class="contact-service-label">${escapeHTML(item.eyebrow)}</span><span class="contact-service-headline">${contactLines(item.headline)}</span><span class="contact-service-summary">${contactLines(item.points)}</span></span><span class="contact-service-visual">${icon(symbol)}</span></span>`;
  }

  function contactQRMarkup(large=false) {
    const qr=ASSETS[contactDetails.qrAssetKey];
    if(qr) return large ? `<img class="contact-qr-full" src="${qr}" alt="${escapeHTML(contactDetails.label || '商务合作')}联系二维码">` : `<button class="contact-qr-image" type="button" data-action="open-contact" aria-label="放大联系二维码"><img src="${qr}" alt="${escapeHTML(contactDetails.label || '商务合作')}联系二维码"></button>`;
    return `<div class="contact-qr-placeholder${large?' contact-qr-large':''}" role="img" aria-label="二维码位置示意，并非可扫描的二维码">${icon('qr-code')}<span>${large?'二维码位置示意':'二维码示意'}</span></div>`;
  }

  function contactActionsMarkup(includeSave=false) {
    const actions=[];
    const qr=ASSETS[contactDetails.qrAssetKey];
    if(includeSave && qr){
      const extension=(contactDetails.qrImage || '').split('.').pop().toLowerCase();
      const suffix=['png','jpg','jpeg','webp','gif','svg'].includes(extension)?extension:'png';
      actions.push(`<a class="contact-link" href="${qr}" download="商务合作二维码.${suffix}">${icon('download')}保存二维码</a>`);
    }
    if(contactDetails.wechatId) actions.push(`<button class="contact-link" type="button" data-action="copy-contact-wechat">${icon('copy')}复制微信号</button>`);
    const phone=String(contactDetails.phone || '').replace(/[^+\d*#;,()-]/g,'');
    if(phone) actions.push(`<a class="contact-link" href="tel:${escapeHTML(phone)}">${icon('phone')}电话咨询</a>`);
    if(contactDetails.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactDetails.email)) actions.push(`<a class="contact-link" href="mailto:${escapeHTML(encodeURIComponent(contactDetails.email))}">${icon('mail')}邮件联系</a>`);
    return actions.length?`<div class="contact-extra-actions">${actions.join('')}</div>`:'';
  }

  function renderContact() {
    $('contact-title').textContent=CONTACT.pageTitle || '服务与合作';
    $('contact-subtitle').textContent=CONTACT.tagline || '';
    $('contact-services-title').textContent=CONTACT.servicesTitle || '我们能为你做什么';
    $('contact-sample-label').hidden=!CONTACT.isDemo;
    root.querySelector('.contact-section-head').hidden=!contactServices.length;
    $('contact-services').innerHTML=contactServices.map(item=>`<button type="button" class="contact-service" data-contact-service="${escapeHTML(item.id)}" aria-label="放大查看${escapeHTML(item.title)}服务图">${contactServiceMarkup(item)}<span class="contact-service-caption"><span>${escapeHTML(item.title)}</span>${icon('maximize-2')}</span></button>`).join('');
    $('contact-business-title').textContent=contactDetails.title || '联系商务合作';
    $('contact-business-intro').textContent=contactDetails.intro || '';
    const details=[contactDetails.method,contactDetails.description].filter(Boolean);
    $('contact-business-card').innerHTML=`${contactQRMarkup()}<div class="contact-business-copy"><h3>${escapeHTML(contactDetails.label || '商务合作')}</h3><p>${contactLines(details)}</p><button class="contact-link" type="button" data-action="open-contact">查看二维码${icon('maximize-2')}</button></div>${contactActionsMarkup()}`;
    $('contact-note').textContent=contactDetails.note || '';
    $('contact-note').hidden=!contactDetails.note;
  }

  function openContactDialog(kind,trigger,serviceId) {
    if(kind==='service'){
      const item=contactServices.find(service=>service.id===serviceId);if(!item)return;
      $('contact-dialog-title').textContent=item.title;
      $('contact-dialog-body').innerHTML=`<div class="contact-service-preview">${contactServiceMarkup(item)}</div>`;
    }else{
      $('contact-dialog-title').textContent='联系'+(contactDetails.label || '商务合作');
      const wechat=contactDetails.wechatId?`<p class="contact-dialog-note">微信号：${escapeHTML(contactDetails.wechatId)}</p>`:'';
      const note=contactDetails.note?`<p class="contact-dialog-note">${escapeHTML(contactDetails.note)}</p>`:'';
      $('contact-dialog-body').innerHTML=`<p class="contact-dialog-copy">${escapeHTML(contactDetails.intro || '')}</p>${contactQRMarkup(true)}${wechat}${contactActionsMarkup(true)}${note}`;
    }
    contactReturnFocus=trigger;
    $('contact-dialog').hidden=false;
    setInert(true);refreshIcons();
    root.querySelector('.contact-dialog-panel').scrollTop=0;
    root.querySelector('.contact-dialog-close').focus();
  }

  function closeContactDialog(restoreFocus=true) {
    if($('contact-dialog').hidden)return;
    $('contact-dialog').hidden=true;setInert(false);
    if(restoreFocus && contactReturnFocus?.isConnected)contactReturnFocus.focus({preventScroll:true});
  }

  function switchPage(page) {
    if (!['catalog','company','cases','contact'].includes(page)) return;
    closeContactDialog(false);
    closeProduct();
    root.querySelectorAll('.page').forEach(p=>{p.hidden=p.id!==page+'-page';});
    root.querySelectorAll('[data-page]').forEach(button=>{
      const active=button.dataset.page===page;
      button.classList.toggle('active',active);
      if(active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
    state.page=page;
    $('app-header').hidden=true;
    $('page-label').textContent={catalog:'产品目录',company:'首页',cases:'品牌案例',contact:'联系我们'}[page];
    if(page!=='company') pauseAutoplay();
    if(page==='company') requestAnimationFrame(()=>{goSlide(state.slide,false);startAutoplay();});
  }

  const track=$('company-track');
  const pagination=$('company-pagination');
  let slides=track?Array.from(track.querySelectorAll(':scope > .company-slide')):[];
  let carouselPointerDown=false;
  let carouselResumeTimer;
  function updateSlideDots() {
    if (!pagination) return;
    for (const dot of pagination.querySelectorAll('.company-dot')) {
      const active=Number(dot.dataset.slideIndex)===state.slide;
      dot.classList.toggle('active',active);
      dot.setAttribute('aria-current',active?'true':'false');
    }
  }
  function goSlide(index,animate=true) {
    if (!slides.length) return;
    const next=(index+slides.length)%slides.length;
    const wrap=Math.abs(next-state.slide)>1;
    if(next!==state.slide) slides[next].scrollTop=0;
    state.slide=next;
    updateSlideDots();
    track.scrollTo({left:slides[next].offsetLeft,behavior:animate&&!wrap&&!reduceMotion.matches?'smooth':'instant'});
  }
  function pauseAutoplay() {
    clearInterval(autoTimer);
    autoTimer=undefined;
    state.playing=false;
  }
  function startAutoplay() {
    pauseAutoplay();
    // 单张海报显示一个指示点，不开启无意义的自动翻页。
    if(slides.length<=1 || state.page!=='company' || document.hidden || !$('product-detail').hidden || carouselPointerDown || slides[state.slide]?.scrollTop>2) return;
    state.playing=true;
    autoTimer=setInterval(()=>{
      if(state.page==='company'&&!document.hidden&&$('product-detail').hidden&&!carouselPointerDown&&slides[state.slide].scrollTop<=2) goSlide(state.slide+1);
    },4000);
  }
  function resumeCarouselAfterInteraction() {
    clearTimeout(carouselResumeTimer);
    carouselResumeTimer=setTimeout(startAutoplay,180);
  }
  function rebuildSlideDots() {
    if(!track || !pagination) return;
    slides=Array.from(track.querySelectorAll(':scope > .company-slide'));
    state.slide=Math.max(0,Math.min(state.slide,Math.max(0,slides.length-1)));
    const fragment=document.createDocumentFragment();
    slides.forEach((slide,i)=>{
      slide.dataset.slide=String(i);
      const previous=slide.getAttribute('aria-label')||'';
      const title=previous.includes('：')?previous.slice(previous.indexOf('：')+1):'';
      slide.setAttribute('aria-label',`第${i+1}张，共${slides.length}张${title?'：'+title:''}`);
      const dot=document.createElement('button');
      dot.type='button';
      dot.className='company-dot';
      dot.dataset.slideIndex=String(i);
      dot.setAttribute('aria-label',`第${i+1}张，共${slides.length}张`);
      fragment.append(dot);
    });
    pagination.replaceChildren(fragment);
    pagination.hidden=slides.length===0;
    updateSlideDots();
    if(state.page==='company') startAutoplay();
  }
  if (track) {
    rebuildSlideDots();
    new MutationObserver(rebuildSlideDots).observe(track,{childList:true});
    pagination.addEventListener('click',e=>{
      const dot=e.target.closest('button[data-slide-index]');
      if(!dot)return;
      goSlide(Number(dot.dataset.slideIndex));
      startAutoplay();
    });
    track.addEventListener('scroll',()=>{
      cancelAnimationFrame(scrollFrame);
      scrollFrame=requestAnimationFrame(()=>{
        if(!track.clientWidth)return;
        const next=Math.max(0,Math.min(slides.length-1,Math.round(track.scrollLeft/track.clientWidth)));
        if(next!==state.slide) slides[next].scrollTop=0;
        state.slide=next;
        updateSlideDots();
      });
      resumeCarouselAfterInteraction();
    },{passive:true});
    // 横向换图，纵向阅读；读到长图中下部时保持当前图片。
    track.addEventListener('scroll',e=>{
      if(e.target===track || e.target!==slides[state.slide]) return;
      pauseAutoplay();
      if(e.target.scrollTop<=2) resumeCarouselAfterInteraction();
    },{capture:true,passive:true});
    track.addEventListener('pointerdown',()=>{
      carouselPointerDown=true;
      clearTimeout(carouselResumeTimer);
      pauseAutoplay();
    },{passive:true});
    const endCarouselPointer=()=>{
      if(!carouselPointerDown) return;
      carouselPointerDown=false;
      resumeCarouselAfterInteraction();
    };
    document.addEventListener('pointerup',endCarouselPointer,{passive:true});
    document.addEventListener('pointercancel',endCarouselPointer,{passive:true});
    track.addEventListener('wheel',()=>{pauseAutoplay();resumeCarouselAfterInteraction();},{passive:true});
    root.querySelector('#company-page').addEventListener('keydown',e=>{
      if((e.key==='ArrowRight'||e.key==='ArrowLeft')&&slides.length>1){
        e.preventDefault();goSlide(state.slide+(e.key==='ArrowRight'?1:-1));startAutoplay();
      }
    });
    new ResizeObserver(()=>{if(state.page==='company')goSlide(state.slide,false);}).observe(track);
  }

  root.addEventListener('click',event=>{
    const button=event.target.closest('button'); if(!button||!root.contains(button))return;
    if(button.dataset.page) switchPage(button.dataset.page);
    else if(button.dataset.module) selectModule(button.dataset.module);
    else if(button.dataset.category) selectCategory(button.dataset.category);
    else if(button.dataset.subcategory) {
      state.subcategory=button.dataset.subcategory;renderProducts(true);
      Array.from($('subfilters').querySelectorAll('button')).find(item=>item.dataset.subcategory===state.subcategory)?.focus({preventScroll:true});
    }
    else if(button.dataset.caseFilter) {state.caseFilter=button.dataset.caseFilter;renderCases();$('filter-'+state.caseFilter).focus({preventScroll:true});}
    else if(button.dataset.product) openProduct(button.dataset.product,button);
    else if(button.id==='close-detail') closeProduct();
    else if(button.id==='copy-code'&&state.viewed?.code) copyText(state.viewed.code,codeLabel(state.viewed)+'已复制','复制'+codeLabel(state.viewed));
    else if(button.id==='clear-search'||button.id==='reset-search'||button.dataset.action==='reset-search') resetSearch();
    else if(button.id==='clear-case-search'||button.dataset.action==='reset-case-search') {state.caseQuery='';$('case-search').value='';state.caseFilter='case_featured';renderCases();$('case-search').focus();}
    else if(button.id==='close-copy-sheet') closeCopySheet();
    else if(button.dataset.action==='open-contact') openContactDialog('contact',button);
    else if(button.dataset.contactService) openContactDialog('service',button,button.dataset.contactService);
    else if(button.dataset.action==='close-contact-dialog') closeContactDialog();
    else if(button.dataset.action==='copy-contact-wechat'&&contactDetails.wechatId) copyText(contactDetails.wechatId,'微信号已复制','复制微信号');
  });
  $('product-search').addEventListener('input',e=>{state.query=e.target.value;renderCategories();renderProducts(true);});
  $('case-search').addEventListener('input',e=>{state.caseQuery=e.target.value;renderCases();});
  $('contact-dialog').addEventListener('click',e=>{if(e.target===$('contact-dialog'))closeContactDialog();});
  root.addEventListener('keydown',e=>{
    const overlay=!$('copy-sheet').hidden?$('copy-sheet'):!$('contact-dialog').hidden?$('contact-dialog'):!$('product-detail').hidden?$('product-detail'):null;
    if(!overlay)return;
    if(e.key==='Escape'){e.preventDefault();if(overlay.id==='copy-sheet')closeCopySheet();else if(overlay.id==='contact-dialog')closeContactDialog();else closeProduct();return;}
    if(e.key==='Tab'){
      const focusable=Array.from(overlay.querySelectorAll('button:not([disabled]),textarea,input,a[href]')).filter(el=>!el.hidden&&el.getClientRects().length);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAutoplay();else if(state.page==='company')startAutoplay();});
  renderModules();renderCategories();renderProducts();renderCases();renderContact();refreshIcons();
  const initialPage=root.dataset.initialPage||window.location.hash.slice(1)||'company';
  if(['company','catalog','cases','contact'].includes(initialPage))switchPage(initialPage);
})();
