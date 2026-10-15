'use strict';

// Parche 12.2 de Midnight («Midnight: Eclipse»): botón de «Próximamente» en el inicio y panel con lo que Blizzard ha mostrado.
// Fuente: avance publicado por @Warcraft_ES el 15 de octubre de 2026. Blizzard no ha dado fecha de salida.
const Patch122 = (() => {
  const L = tr;
  const LINK = 'https://x.com/Warcraft_ES/status/2110641846351237267';

  // lo que muestra el avance (4 imágenes del anuncio): título, subtítulo, descripción
  const CARDS = () => [
    {
      img: 'patch/122-avance.jpg',
      title: 'Midnight: Eclipse',
      sub: L('Avance del parche 12.2', 'Patch 12.2 preview'),
      text: L('El próximo capítulo de Midnight. El anuncio habla de una nueva zona, una daga legendaria y la lucha por proteger el alma-mundo.', 'The next chapter of Midnight. The announcement mentions a new zone, a legendary dagger and the fight to protect the world-soul.'),
    },
    {
      img: 'patch/122-thraegar.jpg',
      title: L('Bastión de Thraegar', 'Thraegar\'s Bastion'),
      sub: L('Mazmorra de tres jefes', 'Three-boss dungeon'),
      text: L('Nueva mazmorra de tres jefes. El avance muestra un gólem de cristal dorado y azul como uno de sus habitantes.', 'New three-boss dungeon. The preview shows a gold and blue crystal golem as one of its inhabitants.'),
    },
    {
      img: 'patch/122-nucleo.jpg',
      title: L('El Núcleo del Mundo', 'The World\'s Core'),
      sub: L('Banda de ocho jefes', 'Eight-boss raid'),
      text: L('Nueva banda de ocho jefes: una cámara con una esfera de fuego suspendida sobre una gran plataforma de mecanismos.', 'New eight-boss raid: a chamber with a sphere of fire hanging over a large platform of mechanisms.'),
    },
    {
      img: 'patch/122-filo.jpg',
      title: L('Filo de Medianoche', 'Midnight\'s Edge'),
      sub: L('Nueva daga legendaria', 'New legendary dagger'),
      text: L('Daga legendaria de una mano que liga al recogerla. La imagen enseña su descripción parcialmente tapada, con efectos relacionados con el Vacío (Void).', 'One-handed legendary dagger that binds when picked up. The image shows its description partly covered, with effects related to the Void.'),
    },
  ];

  function homeHTML() {
    return `<button type="button" class="pn-btn pn-soon" data-p22="open"><span>${L('Parche 12.2', 'Patch 12.2')}</span><em class="pn-soon-tag">${L('Próximamente', 'Coming soon')}</em></button>`;
  }

  function open() {
    let dlg = document.getElementById('patch122Dlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'patch122Dlg';
      dlg.className = 'modal wide settings-dlg pn-dlg';
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (ev) => {
        const link = ev.target.closest('[data-p22-link]');
        if (link) { ev.preventDefault(); window.api.openExternal(link.dataset.p22Link); return; }
        if (ev.target.closest('[data-p22-close]') || ev.target === dlg) dlg.close();
      });
    }
    const cards = CARDS().map((c) => `<article class="p22-card">
        <img src="${c.img}" alt="${esc(c.title)}" loading="lazy">
        <div class="p22-txt"><b>${esc(c.title)}</b><small>${esc(c.sub)}</small><p>${esc(c.text)}</p></div></article>`).join('');
    dlg.innerHTML = `<div class="set-wrap"><div class="set-nav"><h2>${L('Parche 12.2', 'Patch 12.2')}</h2>
        <span class="pn-soon-tag big">${L('Próximamente', 'Coming soon')}</span>
        <span class="grow"></span><button type="button" class="btn ghost" data-p22-close>${L('Cerrar', 'Close')}</button></div>
      <div class="set-body pn-body">
        <div class="pn-ban">Midnight: Eclipse · ${L('avance anunciado el 15 de octubre de 2026', 'preview announced on October 15, 2026')}</div>
        <p class="p22-lead">${L('Explora una nueva zona, hazte con la daga legendaria y lucha para proteger el alma-mundo.', 'Explore a new zone, get the legendary dagger and fight to protect the world-soul.')}</p>
        <div class="p22-grid">${cards}</div>
        <h3 class="pn-h">${L('Qué se sabe', 'What is known')}</h3>
        <ul class="pn-list">
          <li>${L('<b>Contenido:</b> una nueva zona, una mazmorra de tres jefes (Bastión de Thraegar), una banda de ocho jefes (El Núcleo del Mundo) y una daga legendaria (Filo de Medianoche).', '<b>Content:</b> a new zone, a three-boss dungeon (Thraegar\'s Bastion), an eight-boss raid (The World\'s Core) and a legendary dagger (Midnight\'s Edge).')}</li>
          <li>${L('<b>Fecha de salida:</b> Blizzard no la ha anunciado todavía; por eso sale como «Próximamente».', '<b>Release date:</b> Blizzard has not announced it yet, so it is shown as “Coming soon”.')}</li>
          <li>${L('<b>Detalles:</b> el avance no da talentos, ajustes de clases ni fechas de temporada; WipeTime los añadirá cuando se publiquen.', '<b>Details:</b> the preview gives no talents, class changes or season dates; WipeTime will add them when they are published.')}</li>
        </ul>
        <h3 class="pn-h">${L('Fuente', 'Source')}</h3>
        <ul class="pn-list"><li><a href="#" data-p22-link="${LINK}">${L('Avance del parche 12.2 · @Warcraft_ES en X', 'Patch 12.2 preview · @Warcraft_ES on X')}</a></li></ul>
        <p class="foot">${L('Los textos están resumidos por WipeTime a partir del anuncio; las imágenes son del propio avance.', 'Texts are summarized by WipeTime from the announcement; the images are from the preview itself.')}</p>
      </div></div>`;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('.pn-body')?.scrollTo(0, 0);
  }

  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-p22="open"]')) open();
  });

  return { homeHTML, open };
})();
