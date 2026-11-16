import { describe, expect, it } from 'vitest';
import { htmlToText, parseDuckDuckGo, decodeEntities } from '../ai/web';

const DDG = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fmeteofrance.com%2Fprevisions%2Fparis&amp;rut=abc">M&eacute;t&eacute;o <b>Paris</b> - Pr&eacute;visions</a>
    </h2>
    <div class="result__extras"><a class="result__url" href="x">meteofrance.com</a></div>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Pr&eacute;visions <b>météo</b> pour Paris : soleil et 12&#176;C.</a>
  </div>
</div>
<div class="result results_links results_links_deep result--ad">
  <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=pub.com&amp;u3=1">Pub</a>
  <a class="result__snippet" href="x">promo</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://www.lameteo.org/paris">La météo à Paris</a>
  <a class="result__snippet" href="x">Bulletin du jour</a>
</div>`;

describe('recherche web DuckDuckGo', () => {
  it('extrait titres, vraies URL et extraits, ignore les pubs', () => {
    const r = parseDuckDuckGo(DDG);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ title: 'Météo Paris - Prévisions', url: 'https://meteofrance.com/previsions/paris', content: 'Prévisions météo pour Paris : soleil et 12°C.' });
    expect(r[1].url).toBe('https://www.lameteo.org/paris');
  });
  it('convertit une page en texte', () => {
    const p = htmlToText('<html><head><title>Titre &amp; co</title><style>x{}</style></head><body><nav>menu</nav><article><h1>Gros titre</h1><p>Un&nbsp;paragraphe.</p><script>evil()</script><p>Deux</p></article></body></html>');
    expect(p.title).toBe('Titre & co');
    expect(p.text).toBe('Gros titre\nUn paragraphe.\nDeux');
  });
  it('décode les entités', () => {
    expect(decodeEntities('l&#39;&eacute;t&eacute; &#x2014; ok')).toBe("l'été — ok");
  });
});
