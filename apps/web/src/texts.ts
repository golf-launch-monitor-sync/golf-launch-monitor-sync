// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** The page's language and texts (elements marked `data-t`), for every page of the web app. */

import { pickLang, translator, type Lang, type T } from '@glmsync/browser';

export const lang: Lang = pickLang(navigator.languages);
export const t: T = translator(lang);

export function texts(titleKey: Parameters<T>[0]): void {
  document.documentElement.lang = lang;
  document.title = t(titleKey);
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = t(el.dataset.t as Parameters<T>[0]);
}

export const $ = (id: string) => document.getElementById(id) as HTMLElement;
