const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Stockage en mémoire pour les résultats temporaires
const analysisCache = new Map();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Configuration axios avec timeout et user-agent
const axiosConfig = {
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'WebAnalyzer/1.0 (Compatible Web Analyzer Tool)'
  }
};

// Route principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fonction pour valider et normaliser l'URL
function normalizeUrl(inputUrl) {
  try {
    if (!inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
      inputUrl = 'https://' + inputUrl;
    }
    const url = new URL(inputUrl);
    return url.href;
  } catch (error) {
    throw new Error('URL invalide');
  }
}

// Fonction pour analyser un site suspect
function detectSuspiciousSite(url, html, headers, redirectCount) {
  const suspiciousIndicators = [];
  let suspiciousScore = 0;

  try {
    const urlObj = new URL(url);
    
    // Vérifier HTTPS
    if (urlObj.protocol !== 'https:') {
      suspiciousIndicators.push('Pas de HTTPS - connexion non sécurisée');
      suspiciousScore += 30;
    }

    // Vérifier le domaine
    const domain = urlObj.hostname.toLowerCase();
    const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.bit'];
    if (suspiciousTlds.some(tld => domain.endsWith(tld))) {
      suspiciousIndicators.push('Domaine gratuit/suspect détecté');
      suspiciousScore += 25;
    }

    // Domaines très courts ou avec beaucoup de chiffres
    if (domain.length < 5 || /\d{3,}/.test(domain)) {
      suspiciousIndicators.push('Nom de domaine suspect');
      suspiciousScore += 20;
    }

    // Trop de redirections
    if (redirectCount > 3) {
      suspiciousIndicators.push(`Trop de redirections (${redirectCount})`);
      suspiciousScore += 15;
    }

    // Analyser le HTML
    const $ = cheerio.load(html);
    
    // Scripts externes suspects
    const scripts = $('script[src]');
    let suspiciousScripts = 0;
    scripts.each((i, elem) => {
      const src = $(elem).attr('src');
      if (src && !src.startsWith('/') && !src.includes(urlObj.hostname)) {
        suspiciousScripts++;
      }
    });
    
    if (suspiciousScripts > 10) {
      suspiciousIndicators.push('Beaucoup de scripts externes');
      suspiciousScore += 20;
    }

    // Manque de contenu structuré
    const title = $('title').text().trim();
    const h1Count = $('h1').length;
    const pCount = $('p').length;
    
    if (!title || h1Count === 0 || pCount < 3) {
      suspiciousIndicators.push('Structure de contenu pauvre');
      suspiciousScore += 15;
    }

    // Headers de sécurité manquants
    if (!headers['strict-transport-security']) {
      suspiciousIndicators.push('Header HSTS manquant');
      suspiciousScore += 10;
    }

    if (!headers['x-content-type-options']) {
      suspiciousIndicators.push('Headers de sécurité manquants');
      suspiciousScore += 10;
    }

  } catch (error) {
    console.error('Erreur dans l\'analyse de site suspect:', error);
  }

  return {
    isSuspicious: suspiciousScore > 50,
    score: suspiciousScore,
    indicators: suspiciousIndicators,
    level: suspiciousScore > 70 ? 'Très suspect' : 
           suspiciousScore > 50 ? 'Suspect' : 
           suspiciousScore > 25 ? 'Attention' : 'Normal'
  };
}

// Fonction pour analyser le SEO
function analyzeSEO(html, url) {
  const $ = cheerio.load(html);
  let seoScore = 0;
  const seoIssues = [];
  const seoGoodPoints = [];

  // Title
  const title = $('title').text().trim();
  if (title) {
    if (title.length >= 30 && title.length <= 60) {
      seoScore += 20;
      seoGoodPoints.push('Titre de longueur optimale');
    } else if (title.length > 0) {
      seoScore += 10;
      seoIssues.push(`Titre ${title.length < 30 ? 'trop court' : 'trop long'} (${title.length} caractères)`);
    }
  } else {
    seoIssues.push('Titre manquant');
  }

  // Meta description
  const metaDesc = $('meta[name="description"]').attr('content');
  if (metaDesc) {
    if (metaDesc.length >= 120 && metaDesc.length <= 160) {
      seoScore += 20;
      seoGoodPoints.push('Meta description de longueur optimale');
    } else if (metaDesc.length > 0) {
      seoScore += 10;
      seoIssues.push(`Meta description ${metaDesc.length < 120 ? 'trop courte' : 'trop longue'}`);
    }
  } else {
    seoIssues.push('Meta description manquante');
  }

  // Headers H1-H6
  const h1Count = $('h1').length;
  const h2Count = $('h2').length;
  
  if (h1Count === 1) {
    seoScore += 15;
    seoGoodPoints.push('Un seul H1 trouvé (optimal)');
  } else if (h1Count === 0) {
    seoIssues.push('Aucun H1 trouvé');
  } else {
    seoIssues.push(`Plusieurs H1 trouvés (${h1Count})`);
  }

  if (h2Count > 0) {
    seoScore += 10;
    seoGoodPoints.push(`Structure avec H2 (${h2Count})`);
  }

  // Images alt
  const images = $('img');
  let imagesWithAlt = 0;
  images.each((i, elem) => {
    if ($(elem).attr('alt')) imagesWithAlt++;
  });
  
  if (images.length > 0) {
    const altRatio = (imagesWithAlt / images.length) * 100;
    if (altRatio >= 90) {
      seoScore += 15;
      seoGoodPoints.push('Excellent usage des attributs alt');
    } else if (altRatio >= 50) {
      seoScore += 8;
      seoIssues.push(`${Math.round(altRatio)}% des images ont un attribut alt`);
    } else {
      seoIssues.push(`Seulement ${Math.round(altRatio)}% des images ont un attribut alt`);
    }
  }

  // Liens
  const internalLinks = $('a[href^="/"], a[href*="' + new URL(url).hostname + '"]').length;
  const externalLinks = $('a[href^="http"]').not('a[href*="' + new URL(url).hostname + '"]').length;
  
  if (internalLinks > 0) {
    seoScore += 10;
    seoGoodPoints.push(`Liens internes présents (${internalLinks})`);
  }

  // Meta robots
  const metaRobots = $('meta[name="robots"]').attr('content');
  if (metaRobots && !metaRobots.includes('noindex')) {
    seoScore += 5;
  }

  // Canonical
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical) {
    seoScore += 5;
    seoGoodPoints.push('URL canonique définie');
  }

  return {
    score: Math.min(seoScore, 100),
    level: seoScore >= 80 ? 'Excellent' : 
           seoScore >= 60 ? 'Bon' : 
           seoScore >= 40 ? 'Moyen' : 'Faible',
    issues: seoIssues,
    goodPoints: seoGoodPoints,
    details: {
      title: title || 'Non défini',
      titleLength: title ? title.length : 0,
      metaDescription: metaDesc || 'Non définie',
      metaDescLength: metaDesc ? metaDesc.length : 0,
      h1Count,
      h2Count,
      imagesTotal: images.length,
      imagesWithAlt,
      internalLinks,
      externalLinks,
      canonical
    }
  };
}

// Route d'analyse principale
app.post('/analyze', async (req, res) => {
  try {
    const { url, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL requise' });
    }

    const normalizedUrl = normalizeUrl(url);
    
    // Vérifier le cache
    if (analysisCache.has(normalizedUrl)) {
      const cachedResult = analysisCache.get(normalizedUrl);
      if (Date.now() - cachedResult.timestamp < 300000) { // 5 minutes
        return res.json(cachedResult.data);
      }
    }

    const startTime = Date.now();
    
    // Faire la requête HTTP
    const response = await axios.get(normalizedUrl, axiosConfig);
    const responseTime = Date.now() - startTime;
    
    const html = response.data;
    const headers = response.headers;
    const statusCode = response.status;
    
    // Analyser avec Cheerio
    const $ = cheerio.load(html);
    
    // Informations de base
    const title = $('title').text().trim() || 'Non défini';
    const metaDescription = $('meta[name="description"]').attr('content') || 'Non définie';
    const h1Elements = $('h1').map((i, el) => $(el).text().trim()).get();
    const h2Elements = $('h2').map((i, el) => $(el).text().trim()).get();
    
    // Liens
    const allLinks = $('a[href]');
    const internalLinks = [];
    const externalLinks = [];
    
    const urlObj = new URL(normalizedUrl);
    
    allLinks.each((i, elem) => {
      const href = $(elem).attr('href');
      const text = $(elem).text().trim();
      
      if (href) {
        try {
          if (href.startsWith('/') || href.includes(urlObj.hostname)) {
            internalLinks.push({ url: href, text });
          } else if (href.startsWith('http')) {
            externalLinks.push({ url: href, text });
          }
        } catch (e) {
          // Ignorer les liens malformés
        }
      }
    });

    // Taille du HTML
    const htmlSize = Buffer.byteLength(html, 'utf8');

    // Préparer le résultat
    const result = {
      url: normalizedUrl,
      status: statusCode,
      responseTime,
      htmlSize: Math.round(htmlSize / 1024), // en Ko
      title,
      metaDescription,
      h1: h1Elements,
      h2: h2Elements.slice(0, 10), // Limiter à 10 H2
      links: {
        internal: internalLinks.length,
        external: externalLinks.length,
        internalList: internalLinks.slice(0, 20),
        externalList: externalLinks.slice(0, 10)
      },
      headers: {
        server: headers.server || 'Non défini',
        contentType: headers['content-type'] || 'Non défini',
        cacheControl: headers['cache-control'] || 'Non défini',
        hsts: headers['strict-transport-security'] ? 'Activé' : 'Désactivé',
        csp: headers['content-security-policy'] ? 'Activé' : 'Désactivé'
      },
      timestamp: new Date().toISOString()
    };

    // Analyse conditionnelle des sites suspects
    if (options.detectSuspicious) {
      result.suspicious = detectSuspiciousSite(normalizedUrl, html, headers, response.request._redirects || 0);
    }

    // Analyse SEO conditionnelle
    if (options.seoAnalysis) {
      result.seo = analyzeSEO(html, normalizedUrl);
    }

    // Stocker en cache
    analysisCache.set(normalizedUrl, {
      data: result,
      timestamp: Date.now()
    });

    // Nettoyer le cache si trop grand
    if (analysisCache.size > 100) {
      const oldestKey = analysisCache.keys().next().value;
      analysisCache.delete(oldestKey);
    }

    res.json(result);

  } catch (error) {
    console.error('Erreur lors de l\'analyse:', error);
    
    let errorMessage = 'Erreur lors de l\'analyse du site';
    
    if (error.code === 'ENOTFOUND') {
      errorMessage = 'Site web introuvable';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connexion refusée par le serveur';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Délai d\'attente dépassé';
    } else if (error.message === 'URL invalide') {
      errorMessage = 'URL invalide';
    }

    res.status(400).json({ error: errorMessage });
  }
});

// Route pour nettoyer le cache
app.delete('/cache', (req, res) => {
  analysisCache.clear();
  res.json({ message: 'Cache nettoyé' });
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📝 Interface disponible sur http://localhost:${PORT}`);
});

module.exports = app;
