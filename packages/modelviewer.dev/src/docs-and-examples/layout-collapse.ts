/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const SIDEBAR_COLLAPSED = 'sidebar-collapsed';
const CONTENT_COLLAPSED = 'content-collapsed';
const CHEVRON_COLLAPSE = '‹';
const CHEVRON_EXPAND = '›';

function isContentExpanded(): boolean {
  return !document.body.classList.contains(CONTENT_COLLAPSED);
}

function isSidebarExpanded(): boolean {
  return !document.body.classList.contains(SIDEBAR_COLLAPSED);
}

function syncSidebarRail(rail: HTMLButtonElement) {
  const expanded = isSidebarExpanded();
  rail.setAttribute('aria-expanded', String(expanded));
  rail.setAttribute(
      'aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
  rail.textContent = expanded ? CHEVRON_COLLAPSE : CHEVRON_EXPAND;
}

function syncContentRails(rails: HTMLButtonElement[]) {
  const expanded = isContentExpanded();
  for (let i = 0; i < rails.length; i++) {
    const rail = rails[i];
    rail.setAttribute('aria-expanded', String(expanded));
    rail.setAttribute(
        'aria-label',
        expanded ? 'Collapse info and code' : 'Expand info and code');
    rail.textContent = expanded ? CHEVRON_COLLAPSE : CHEVRON_EXPAND;
  }
}

function createRailButton(className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  return button;
}

/**
 * Inject page-level sidebar/content collapse rails for example pages.
 * Initial state is read from body classes (e.g. sidebar-collapsed content-collapsed).
 */
export function initLayoutCollapse() {
  const examplesContainer = document.querySelector('.examples-container');
  const sidebar = document.querySelector('.sidebar');
  if (examplesContainer == null || sidebar == null) {
    return;
  }

  document.body.classList.add('has-layout-collapse');

  const sidebarRail = createRailButton('sidebar-collapse-rail');
  sidebar.insertAdjacentElement('afterend', sidebarRail);
  syncSidebarRail(sidebarRail);
  sidebarRail.addEventListener('click', () => {
    document.body.classList.toggle(SIDEBAR_COLLAPSED);
    syncSidebarRail(sidebarRail);
  });

  const samples = examplesContainer.querySelectorAll('.sample');
  const contentRails: HTMLButtonElement[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.querySelector('.content') == null ||
        sample.querySelector('.demo') == null) {
      continue;
    }
    if (sample.querySelector('.content-collapse-rail') != null) {
      continue;
    }
    const contentRail = createRailButton('content-collapse-rail');
    sample.appendChild(contentRail);
    contentRails.push(contentRail);
    contentRail.addEventListener('click', () => {
      document.body.classList.toggle(CONTENT_COLLAPSED);
      syncContentRails(contentRails);
    });
  }
  syncContentRails(contentRails);
}
