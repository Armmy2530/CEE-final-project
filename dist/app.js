const projects = [
  {name:'Final Exams Tutoring Camp',category:'Academic',icon:'✳',lead:'Nicha P.',initials:'NP',status:'In progress',progress:78,budget:85000,due:'Nov 15, 2026',tone:'academic'},
  {name:'International Food Fair',category:'Social',icon:'♡',lead:'Mark T.',initials:'MT',status:'In progress',progress:52,budget:120000,due:'Nov 19, 2026',tone:'social'},
  {name:'Alumni Connect',category:'Community',icon:'⌁',lead:'Pim W.',initials:'PW',status:'In progress',progress:34,budget:45000,due:'Dec 02, 2026',tone:'community'},
  {name:'Winter Welcome Week',category:'Social',icon:'✿',lead:'June K.',initials:'JK',status:'Planning',progress:18,budget:95000,due:'Dec 08, 2026',tone:'social'},
  {name:'Member Care Packages',category:'Operations',icon:'▧',lead:'Beam S.',initials:'BS',status:'Completed',progress:100,budget:36000,due:'Oct 28, 2026',tone:'operations'},
  {name:'Campus Culture Night',category:'Community',icon:'✦',lead:'Nicha P.',initials:'NP',status:'Completed',progress:100,budget:68000,due:'Oct 12, 2026',tone:'community'}
];
const tbody=document.querySelector('#project-rows');
function money(n){return '฿'+n.toLocaleString('en-US')}
function renderProjects(){
  const q=(document.querySelector('#project-search')?.value||'').toLowerCase();
  const status=document.querySelector('#status-filter')?.value||'all';
  const category=document.querySelector('#category-filter')?.value||'all';
  const filtered=projects.filter(p=>(p.name.toLowerCase().includes(q)||p.lead.toLowerCase().includes(q)||p.category.toLowerCase().includes(q))&&(status==='all'||p.status===status)&&(category==='all'||p.category===category));
  tbody.innerHTML=filtered.map(p=>`<tr><td><div class="project-title-cell"><span class="table-project-icon ${p.tone}">${p.icon}</span><span><span class="project-name">${p.name}</span><span class="project-category">${p.category}</span></span></div></td><td><div class="lead-cell"><span class="lead-avatar">${p.initials}</span><span class="lead-name">${p.lead}</span></div></td><td><span class="status-pill ${p.status==='In progress'?'progress':p.status==='Planning'?'planning':'completed'}">${p.status}</span></td><td class="progress-cell"><div class="progress-meta"><span>Progress</span><b>${p.progress}%</b></div><div class="table-progress"><i style="width:${p.progress}%"></i></div></td><td class="budget-cell">${money(p.budget)}</td><td class="due-cell">${p.due}</td><td><button class="row-more" aria-label="More options for ${p.name}" data-project="${p.name}">···</button></td></tr>`).join('');
  document.querySelector('#shown-count').textContent=filtered.length;
  document.querySelector('#empty-projects').hidden=filtered.length>0;
  document.querySelector('.project-table').hidden=filtered.length===0;
}
renderProjects();
document.querySelector('#project-search').addEventListener('input',renderProjects);
document.querySelector('#status-filter').addEventListener('change',renderProjects);
document.querySelector('#category-filter').addEventListener('change',renderProjects);
let toastTimer;
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400)}
function setView(name){
  const isSummary=name==='summary',isProjects=name==='projects';
  document.querySelector('#summary-view').classList.toggle('active-view',isSummary);
  document.querySelector('#projects-view').classList.toggle('active-view',isProjects);
  document.querySelector('#other-view').classList.toggle('active-view',!isSummary&&!isProjects);
  document.querySelector('#breadcrumb-current').textContent=isSummary?'Summary':isProjects?'Project data':name[0].toUpperCase()+name.slice(1);
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  document.querySelectorAll('.main-tab').forEach(b=>{const active=b.dataset.view===name;b.classList.toggle('selected',active);b.setAttribute('aria-selected',String(active))});
  if(!isSummary&&!isProjects){const labels={calendar:['Events calendar','CALENDAR','Keep track of everything happening this semester.','Your events, all in one view.'],members:['Members','MEMBERS','Get a clear picture of your club community.','Your members, all in one place.'],budget:['Budget','BUDGET','Stay on top of planned and actual club spending.','Your club finances at a glance.'],reports:['Reports','REPORTS','Turn club activity into a clear semester report.','Your reports will live here.']};const v=labels[name]||labels.reports;document.querySelector('#other-title').textContent=v[0];document.querySelector('#other-eyebrow').textContent=v[1];document.querySelector('#other-description').textContent=v[2];document.querySelector('#placeholder-heading').textContent=v[3]}
  window.scrollTo({top:0,behavior:'smooth'});
}
document.addEventListener('click',e=>{const v=e.target.closest('[data-view]');if(v){setView(v.dataset.view);return}if(e.target.closest('#export-btn')){const rows=[['Project','Category','Lead','Status','Progress','Budget','Due date'],...projects.map(p=>[p.name,p.category,p.lead,p.status,p.progress+'%',p.budget,p.due])];const csv=rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download='clubhouse-project-report.csv';link.click();URL.revokeObjectURL(link.href);toast('Your project report is ready to download.')}if(e.target.closest('#sync-btn')){const b=document.querySelector('#sync-btn');b.textContent='✓ Synced just now';toast('Master Sheet is up to date.');setTimeout(()=>b.textContent='↻ Sync now',2000)}if(e.target.closest('#assistant-toggle')){document.querySelector('#assistant-panel').hidden=false;document.querySelector('#chat-input').focus()}if(e.target.closest('#assistant-close'))document.querySelector('#assistant-panel').hidden=true;if(e.target.closest('.theme-button')){document.documentElement.classList.toggle('dark');localStorage.setItem('clubhouse-theme',document.documentElement.classList.contains('dark')?'dark':'light')}if(e.target.closest('.notification-button')){const pop=document.querySelector('.notice-popover');pop.hidden=!pop.hidden}if(e.target.closest('#add-project')||e.target.closest('#add-project-two'))document.querySelector('#project-dialog').showModal();if(e.target.closest('.suggestion')){const text=e.target.closest('.suggestion').firstChild.textContent.trim();askAssistant(text)}if(e.target.closest('.row-more'))toast('Project details are coming soon.')});
if(localStorage.getItem('clubhouse-theme')==='dark')document.documentElement.classList.add('dark');
document.querySelector('#save-project').addEventListener('click',e=>{e.preventDefault();const input=document.querySelector('#new-project-name');if(!input.value.trim()){input.focus();return}const name=input.value.trim(),category=document.querySelector('#new-project-category').value;projects.unshift({name,category,icon:category==='Academic'?'✳':category==='Social'?'♡':category==='Community'?'⌁':'▧',lead:'Pim W.',initials:'PW',status:'Planning',progress:0,budget:0,due:'Not set',tone:category.toLowerCase()});input.value='';document.querySelector('#project-dialog').close();renderProjects();setView('projects');toast('Project created in this prototype.')});
function askAssistant(message){const area=document.querySelector('#chat-messages');const user=document.createElement('div');user.className='chat-bubble user';user.textContent=message;area.append(user);const reply=document.createElement('div');reply.className='chat-bubble';if(/budget|left|spent/i.test(message))reply.textContent='Your club has ฿180,500 left from the planned ฿565,000 budget. That means 68% has been used so far.';else if(/attend|event/i.test(message))reply.textContent='Culture Fest had the highest attendance in the last six events, with about 56 members joining.';else reply.textContent='I can help with the club overview: you have 67 active members, 20 events held, and 4 active projects this semester.';area.append(reply);area.scrollTop=area.scrollHeight}
document.querySelector('#chat-form').addEventListener('submit',e=>{e.preventDefault();const input=document.querySelector('#chat-input');if(input.value.trim()){askAssistant(input.value.trim());input.value=''}});
