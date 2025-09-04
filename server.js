const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Stockage en mémoire pour les résultats temporaires
const analysisCache = new Map();

// Base de données des User-Agents
const USER_AGENTS = {
  'alyze-desktop': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Alyze/1.0 Desktop',
  'alyze-mobile': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Alyze/1.0 Mobile',
  'chrome-windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'chrome-android': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'safari-macos': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'edge-windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'googlebot': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'googlebot-mobile': 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'bingbot': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'mediapartners': 'Mediapartners-Google'
};

// Base de données des localisations (simulation via headers)
const LOCATIONS = {
  'france-paris': {
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'X-Forwarded-For': '185.24.184.1' // IP française
  },
  'france-nice': {
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'X-Forwarded-For': '89.158.128.1' // IP française
  },
  'usa-washington': {
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Forwarded-For': '23.239.5.1' // IP américaine
  }
};

// Langues supportées pour l'analyse
const LANGUAGES = {
  'auto': 'Détection automatique',
  'fr': 'Français',
  'en': 'Anglais',
  'es': 'Espagnol',
  'it': 'Italien',
  'pt': 'Portugais',
  'de': 'Allemand',
  'nl': 'Néerlandais'
};

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Route principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fonction pour détecter la langue d'une page
function detectLanguage(html) {
  const $ = cheerio.load(html);
  
  // Vérifier l'attribut lang
  const htmlLang = $('html').attr('lang');
  if (htmlLang) {
    return htmlLang.substring(0, 2).toLowerCase();
  }
  
  // Vérifier les meta
  const metaLang = $('meta[http-equiv="content-language"]').attr('content');
  if (metaLang) {
    return metaLang.substring(0, 2).toLowerCase();
  }
  
  // Analyse basique du contenu pour détecter la langue
  const text = $('body').text().toLowerCase();
  const frenchWords = ['le', 'la', 'les', 'de', 'et', 'à', 'un', 'une', 'du', 'des'];
  const englishWords = ['the', 'and', 'to', 'of', 'a', 'in', 'is', 'it', 'you', 'that'];
  const spanishWords = ['el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'es', 'se'];
  
  let frenchScore = 0, englishScore = 0, spanishScore = 0;
  
  frenchWords.forEach(word => {
    if (text.includes(` ${word} `)) frenchScore++;
  });
  
  englishWords.forEach(word => {
    if (text.includes(` ${word} `)) englishScore++;
  });
  
  spanishWords.forEach(word => {
    if (text.includes(` ${word} `)) spanishScore++;
  });
  
  if (frenchScore > englishScore && frenchScore > spanishScore) return 'fr';
  if (spanishScore > englishScore && spanishScore > frenchScore) return 'es';
  return 'en'; // Par défaut
}

// Fonction pour analyser les performances avancées
function analyzeAdvancedPerformance(html, responseTime, headers) {
  const $ = cheerio.load(html);
  
  // Comptage des ressources
  const images = $('img').length;
  const scripts = $('script').length;
  const stylesheets = $('link[rel="stylesheet"]').length;
  const externalScripts = $('script[src]').filter((i, el) => {
    const src = $(el).attr('src');
    return src && (src.startsWith('http') || src.startsWith('//'));
  }).length;
  
  // Analyse du cache
  const cacheScore = headers['cache-control'] ? 
    (headers['cache-control'].includes('max-age') ? 20 : 10) : 0;
  
  // Analyse de la compression
  const compressionScore = headers['content-encoding'] ? 
    (headers['content-encoding'].includes('gzip') || headers['content-encoding'].includes('br') ? 20 : 10) : 0;
  
  // Score de performance global
  let perfScore = 100;
  if (responseTime > 3000) perfScore -= 30;
  else if (responseTime > 1000) perfScore -= 15;
  
  if (images > 50) perfScore -= 10;
  if (scripts > 20) perfScore -= 10;
  if (externalScripts > 10) perfScore -= 15;
  
  perfScore += cacheScore + compressionScore;
  perfScore = Math.max(0, Math.min(100, perfScore));
  
  return {
    score: perfScore,
    level: perfScore >= 80 ? 'Excellent' : 
           perfScore >= 60 ? 'Bon' : 
           perfScore >= 40 ? 'Moyen' : 'Faible',
    details: {
      responseTime,
      images,
      scripts,
      stylesheets,
      externalScripts,
      hasCompression: compressionScore > 0,
      hasCaching: cacheScore > 0
    },
    recommendations: generatePerformanceRecommendations(perfScore, responseTime, images, scripts, externalScripts)
  };
}

function generatePerformanceRecommendations(score, responseTime, images, scripts, externalScripts) {
  const recommendations = [];
  
  if (responseTime > 3000) {
    recommendations.push('Temps de réponse très lent (>3s) - Optimiser le serveur');
  } else if (responseTime > 1000) {
    recommendations.push('Temps de réponse lent (>1s) - Envisager une optimisation');
  }
  
  if (images > 50) {
    recommendations.push(`Nombreuses images (${images}) - Optimiser et compresser`);
  }
  
  if (scripts > 20) {
    recommendations.push(`Trop de scripts (${scripts}) - Minifier et combiner`);
  }
  
  if (externalScripts > 10) {
    recommendations.push(`Nombreux scripts externes (${externalScripts}) - Réduire les dépendances`);
  }
  
  if (score < 60) {
    recommendations.push('Activer la compression gzip/brotli');
    recommendations.push('Configurer la mise en cache des ressources statiques');
  }
  
  return recommendations;
}

// Fonction pour analyser l'accessibilité
function analyzeAccessibility(html) {
  const $ = cheerio.load(html);
  let a11yScore = 100;
  const issues = [];
  const goodPoints = [];
  
  // Images sans alt
  const imagesWithoutAlt = $('img:not([alt])').length;
  const totalImages = $('img').length;
  if (imagesWithoutAlt > 0) {
    a11yScore -= (imagesWithoutAlt / totalImages) * 20;
    issues.push(`${imagesWithoutAlt} images sans attribut alt sur ${totalImages}`);
  } else if (totalImages > 0) {
    goodPoints.push('Toutes les images ont un attribut alt');
  }
  
  // Liens sans texte
  const linksWithoutText = $('a:not(:has(*))').filter((i, el) => !$(el).text().trim()).length;
  if (linksWithoutText > 0) {
    a11yScore -= linksWithoutText * 5;
    issues.push(`${linksWithoutText} liens sans texte descriptif`);
  }
  
  // Structure des headings
  const h1Count = $('h1').length;
  if (h1Count === 0) {
    a11yScore -= 15;
    issues.push('Aucun titre H1 trouvé');
  } else if (h1Count > 1) {
    a11yScore -= 10;
    issues.push(`Plusieurs H1 trouvés (${h1Count}) - Un seul recommandé`);
  } else {
    goodPoints.push('Structure de titres correcte (1 H1)');
  }
  
  // Labels pour les inputs
  const inputsWithoutLabels = $('input:not([aria-label]):not([aria-labelledby])').filter((i, el) => {
    const id = $(el).attr('id');
    return !id || !$(`label[for="${id}"]`).length;
  }).length;
  
  if (inputsWithoutLabels > 0) {
    a11yScore -= inputsWithoutLabels * 10;
    issues.push(`${inputsWithoutLabels} champs de formulaire sans label`);
  }
  
  // Contraste (estimation basique)
  const hasLowContrastElements = $('[style*="color"]:contains("gray"), [style*="color"]:contains("#999"), [style*="color"]:contains("#ccc")').length > 0;
  if (hasLowContrastElements) {
    a11yScore -= 10;
    issues.push('Éléments avec potentiellement un faible contraste détectés');
  }
  
  // Lang attribute
  const hasLangAttribute = $('html[lang]').length > 0;
  if (!hasLangAttribute) {
    a11yScore -= 10;
    issues.push('Attribut lang manquant sur l\'élément html');
  } else {
    goodPoints.push('Attribut de langue défini');
  }
  
  a11yScore = Math.max(0, a11yScore);
  
  return {
    score: Math.round(a11yScore),
    level: a11yScore >= 90 ? 'Excellent' : 
           a11yScore >= 70 ? 'Bon' : 
           a11yScore >= 50 ? 'Moyen' : 'Faible',
    issues,
    goodPoints
  };
}

// Fonction pour analyser la sécurité avancée
function analyzeAdvancedSecurity(url, html, headers) {
  const $ = cheerio.load(html);
  const urlObj = new URL(url);
  let securityScore = 100;
  const issues = [];
  const goodPoints = [];
  
  // HTTPS
  if (urlObj.protocol !== 'https:') {
    securityScore -= 30;
    issues.push('Site non sécurisé (HTTP au lieu de HTTPS)');
  } else {
    goodPoints.push('Connexion sécurisée HTTPS');
  }
  
  // Headers de sécurité
  const securityHeaders = {
    'strict-transport-security': 'HSTS - Force HTTPS',
    'content-security-policy': 'CSP - Prévient les attaques XSS',
    'x-content-type-options': 'Prévient le MIME sniffing',
    'x-frame-options': 'Prévient le clickjacking',
    'x-xss-protection': 'Protection XSS basique',
    'referrer-policy': 'Contrôle des informations de référent'
  };
  
  Object.entries(securityHeaders).forEach(([header, description]) => {
    if (headers[header]) {
      goodPoints.push(`${description} activé`);
    } else {
      securityScore -= 10;
      issues.push(`${description} manquant`);
    }
  });
  
  // Formulaires non sécurisés
  const unsecureForms = $('form:not([action^="https"])').length;
  if (unsecureForms > 0) {
    securityScore -= unsecureForms * 15;
    issues.push(`${unsecureForms} formulaire(s) potentiellement non sécurisé(s)`);
  }
  
  // Scripts externes
  const externalScripts = $('script[src]').filter((i, el) => {
    const src = $(el).attr('src');
    return src && src.startsWith('http') && !src.includes(urlObj.hostname);
  }).length;
  
  if (externalScripts > 5) {
    securityScore -= Math.min(20, externalScripts * 2);
    issues.push(`${externalScripts} scripts externes - Risque de sécurité`);
  }
  
  securityScore = Math.max(0, securityScore);
  
  return {
    score: Math.round(securityScore),
    level: securityScore >= 90 ? 'Excellent' : 
           securityScore >= 70 ? 'Bon' : 
           securityScore >= 50 ? 'Moyen' : 'Critique',
    issues,
    goodPoints,
    protocol: urlObj.protocol,
    securityHeaders: Object.keys(securityHeaders).reduce((acc, header) => {
      acc[header] = !!headers[header];
      return acc;
    }, {})
  };
}

// Fonction pour créer la configuration axios selon les paramètres
function createAxiosConfig(options) {
  const userAgent = USER_AGENTS[options.userAgent] || USER_AGENTS['alyze-desktop'];
  const location = LOCATIONS[options.location] || LOCATIONS['france-paris'];
  
  return {
    timeout: 30000, // Augmenté pour les analyses complexes
    maxRedirects: options.followRedirects ? 10 : 0,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Upgrade-Insecure-Requests': '1',
      ...location
    },
    validateStatus: function (status) {
      return status < 500; // Accepter toutes les réponses < 500
    }
  };
}

// Route d'analyse principale enrichie
app.post('/analyze', async (req, res) => {
  try {
    const { 
      url, 
      options = {
        language: 'auto',
        userAgent: 'alyze-desktop',
        location: 'france-paris',
        followRedirects: true,
        detectSuspicious: true,
        seoAnalysis: true,
        performanceAnalysis: true,
        accessibilityAnalysis: true,
        securityAnalysis: true
      }
    } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL requise' });
    }

    const normalizedUrl = normalizeUrl(url);
    const cacheKey = `${normalizedUrl}-${JSON.stringify(options)}`;
    
    // Vérifier le cache
    if (analysisCache.has(cacheKey)) {
      const cachedResult = analysisCache.get(cacheKey);
      if (Date.now() - cachedResult.timestamp < 300000) { // 5 minutes
        return res.json(cachedResult.data);
      }
    }

    const startTime = Date.now();
    const axiosConfig = createAxiosConfig(options);
    
    // Faire la requête HTTP
    const response = await axios.get(normalizedUrl, axiosConfig);
    const responseTime = Date.now() - startTime;
    
    const html = response.data;
    const headers = response.headers;
    const statusCode = response.status;
    
    // Analyser avec Cheerio
    const $ = cheerio.load(html);
    
    // Détection de langue
    const detectedLanguage = options.language === 'auto' ? 
      detectLanguage(html) : options.language;
    
    // Informations de base enrichies
    const title = $('title').text().trim() || 'Non défini';
    const metaDescription = $('meta[name="description"]').attr('content') || 'Non définie';
    const metaKeywords = $('meta[name="keywords"]').attr('content') || 'Non définies';
    const canonical = $('link[rel="canonical"]').attr('href') || 'Non définie';
    const robots = $('meta[name="robots"]').attr('content') || 'Non défini';
    
    // Analyse des headings plus détaillée
    const headings = {
      h1: $('h1').map((i, el) => $(el).text().trim()).get(),
      h2: $('h2').map((i, el) => $(el).text().trim()).get(),
      h3: $('h3').map((i, el) => $(el).text().trim()).get(),
      h4: $('h4').map((i, el) => $(el).text().trim()).get(),
      h5: $('h5').map((i, el) => $(el).text().trim()).get(),
      h6: $('h6').map((i, el) => $(el).text().trim()).get()
    };
    
    // Analyse des liens enrichie
    const allLinks = $('a[href]');
    const internalLinks = [];
    const externalLinks = [];
    const urlObj = new URL(normalizedUrl);
    
    allLinks.each((i, elem) => {
      const href = $(elem).attr('href');
      const text = $(elem).text().trim();
      const title = $(elem).attr('title') || '';
      
      if (href) {
        try {
          if (href.startsWith('/') || href.includes(urlObj.hostname)) {
            internalLinks.push({ url: href, text, title });
          } else if (href.startsWith('http')) {
            externalLinks.push({ url: href, text, title });
          }
        } catch (e) {
          // Ignorer les liens malformés
        }
      }
    });

    // Analyse des médias
    const media = {
      images: $('img').length,
      videos: $('video').length,
      audios: $('audio').length,
      iframes: $('iframe').length
    };

    // Analyse des réseaux sociaux
    const socialMeta = {
      ogTitle: $('meta[property="og:title"]').attr('content'),
      ogDescription: $('meta[property="og:description"]').attr('content'),
      ogImage: $('meta[property="og:image"]').attr('content'),
      twitterCard: $('meta[name="twitter:card"]').attr('content'),
      twitterTitle: $('meta[name="twitter:title"]').attr('content'),
      twitterDescription: $('meta[name="twitter:description"]').attr('content')
    };

    // Technologies détectées
    const technologies = [];
    if ($('script[src*="jquery"]').length) technologies.push('jQuery');
    if ($('script[src*="bootstrap"]').length || $('link[href*="bootstrap"]').length) technologies.push('Bootstrap');
    if ($('script[src*="react"]').length) technologies.push('React');
    if ($('script[src*="vue"]').length) technologies.push('Vue.js');
    if ($('script[src*="angular"]').length) technologies.push('Angular');
    if (headers.server) technologies.push(headers.server);
    
    // Taille et statistiques
    const htmlSize = Buffer.byteLength(html, 'utf8');
    const wordCount = $('body').text().split(/\s+/).length;
    
    // Préparer le résultat de base
    const result = {
      url: normalizedUrl,
      analysisOptions: options,
      status: statusCode,
      responseTime,
      language: {
        detected: detectedLanguage,
        requested: options.language,
        name: LANGUAGES[detectedLanguage] || 'Inconnue'
      },
      htmlSize: Math.round(htmlSize / 1024), // en Ko
      wordCount,
      title,
      titleLength: title.length,
      metaDescription,
      metaDescriptionLength: metaDescription.length,
      metaKeywords,
      canonical,
      robots,
      headings,
      links: {
        internal: internalLinks.length,
        external: externalLinks.length,
        internalList: internalLinks.slice(0, 50),
        externalList: externalLinks.slice(0, 20)
      },
      media,
      socialMeta,
      technologies,
      headers: {
        server: headers.server || 'Non défini',
        contentType: headers['content-type'] || 'Non défini',
        contentLength: headers['content-length'] || 'Non défini',
        lastModified: headers['last-modified'] || 'Non défini',
        etag: headers.etag || 'Non défini',
        cacheControl: headers['cache-control'] || 'Non défini',
        expires: headers.expires || 'Non défini',
        contentEncoding: headers['content-encoding'] || 'Aucune',
        hsts: headers['strict-transport-security'] ? 'Activé' : 'Désactivé',
        csp: headers['content-security-policy'] ? 'Activé' : 'Désactivé'
      },
      redirectChain: response.request?._redirects || [],
      timestamp: new Date().toISOString()
    };

    // Analyses conditionnelles enrichies
    if (options.detectSuspicious) {
      result.suspicious = detectSuspiciousSite(normalizedUrl, html, headers, response.request?._redirects?.length || 0);
    }

    if (options.seoAnalysis) {
      result.seo = analyzeSEO(html, normalizedUrl);
    }
    
    if (options.performanceAnalysis) {
      result.performance = analyzeAdvancedPerformance(html, responseTime, headers);
    }
    
    if (options.accessibilityAnalysis) {
      result.accessibility = analyzeAccessibility(html);
    }
    
    if (options.securityAnalysis) {
      result.security = analyzeAdvancedSecurity(normalizedUrl, html, headers);
    }

    // Stocker en cache
    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    // Nettoyer le cache si trop grand
    if (analysisCache.size > 200) {
      const oldestKeys = Array.from(analysisCache.keys()).slice(0, 50);
      oldestKeys.forEach(key => analysisCache.delete(key));
    }

    res.json(result);

  } catch (error) {
    console.error('Erreur lors de l\'analyse:', error);
    
    let errorMessage = 'Erreur lors de l\'analyse du site';
    
    if (error.code === 'ENOTFOUND') {
      errorMessage = 'Site web introuvable (DNS)';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connexion refusée par le serveur';
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      errorMessage = 'Délai d\'attente dépassé (30s)';
    } else if (error.code === 'CERT_HAS_EXPIRED') {
      errorMessage = 'Certificat SSL expiré';
    } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      errorMessage = 'Certificat SSL non valide';
    } else if (error.message === 'URL invalide') {
      errorMessage = 'URL invalide';
    }

    res.status(400).json({ 
      error: errorMessage,
      details: error.message,
      code: error.code 
    });
  }
});

// Route pour obtenir les options disponibles
app.get('/options', (req, res) => {
  res.json({
    languages: LANGUAGES,
    userAgents: Object.keys(USER_AGENTS).reduce((acc, key) => {
      acc[key] = USER_AGENTS[key].includes('Googlebot') ? 'Bot - ' + USER_AGENTS[key].split(' ')[0] :
                 USER_AGENTS[key].includes('Mozilla') ? USER_AGENTS[key].match(/\(([^)]+)\)/)?.[1] || key : key;
      return acc;
    }, {}),
    locations: {
      'france-paris': 'France (Paris)',
      'france-nice': 'France (Nice)', 
      'usa-washington': 'USA (Washington D.C.)'
    }
  });
});

// Fonctions utilitaires existantes (maintenues)
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
    const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.bit', '.pw', '.top'];
    if (suspiciousTlds.some(tld => domain.endsWith(tld))) {
      suspiciousIndicators.push('Extension de domaine suspecte');
      suspiciousScore += 25;
    }

    // Domaines très courts ou avec beaucoup de chiffres
    if (domain.length < 5 || /\d{4,}/.test(domain)) {
      suspiciousIndicators.push('Nom de domaine suspect');
      suspiciousScore += 20;
    }

    // Trop de redirections
    if (redirectCount > 5) {
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
    
    if (suspiciousScripts > 15) {
      suspiciousIndicators.push('Beaucoup de scripts externes');
      suspiciousScore += 20;
    }

    // Manque de contenu structuré
    const title = $('title').text().trim();
    const h1Count = $('h1').length;
    const pCount = $('p').length;
    
    if (!title || h1Count === 0 || pCount < 5) {
      suspiciousIndicators.push('Structure de contenu insuffisante');
      suspiciousScore += 15;
    }

    // Headers de sécurité manquants
    const missingSecurityHeaders = [];
    if (!headers['strict-transport-security']) missingSecurityHeaders.push('HSTS');
    if (!headers['content-security-policy']) missingSecurityHeaders.push('CSP');
    if (!headers['x-content-type-options']) missingSecurityHeaders.push('X-Content-Type-Options');
    
    if (missingSecurityHeaders.length >= 2) {
      suspiciousIndicators.push(`Headers de sécurité manquants: ${missingSecurityHeaders.join(', ')}`);
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

// Fonction pour analyser le SEO (enrichie)
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
      seoGoodPoints.push('Titre de longueur optimale (30-60 caractères)');
    } else if (title.length > 0) {
      seoScore += 10;
      seoIssues.push(`Titre ${title.length < 30 ? 'trop court' : 'trop long'} (${title.length} caractères)`);
    }
  } else {
    seoIssues.push('Titre manquant - Critique pour le SEO');
  }

  // Meta description
  const metaDesc = $('meta[name="description"]').attr('content');
  if (metaDesc) {
    if (metaDesc.length >= 120 && metaDesc.length <= 160) {
      seoScore += 20;
      seoGoodPoints.push('Meta description de longueur optimale (120-160 caractères)');
    } else if (metaDesc.length > 0) {
      seoScore += 10;
      seoIssues.push(`Meta description ${metaDesc.length < 120 ? 'trop courte' : 'trop longue'} (${metaDesc.length} caractères)`);
    }
  } else {
    seoIssues.push('Meta description manquante - Important pour les SERP');
  }

  // Headers H1-H6
  const h1Count = $('h1').length;
  const h2Count = $('h2').length;
  const h3Count = $('h3').length;
  
  if (h1Count === 1) {
    seoScore += 15;
    seoGoodPoints.push('Structure H1 parfaite (exactement 1 H1)');
  } else if (h1Count === 0) {
    seoIssues.push('Aucun H1 trouvé - Essentiel pour la structure');
  } else {
    seoIssues.push(`Plusieurs H1 trouvés (${h1Count}) - Un seul recommandé`);
  }

  if (h2Count > 0) {
    seoScore += 10;
    seoGoodPoints.push(`Bonne structure avec H2 (${h2Count})`);
  }

  if (h3Count > 0) {
    seoScore += 5;
    seoGoodPoints.push(`Structure hiérarchique avec H3 (${h3Count})`);
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
      seoGoodPoints.push('Excellent usage des attributs alt (>90%)');
    } else if (altRatio >= 70) {
      seoScore += 10;
      seoGoodPoints.push(`Bon usage des attributs alt (${Math.round(altRatio)}%)`);
    } else if (altRatio >= 50) {
      seoScore += 5;
      seoIssues.push(`Usage moyen des attributs alt (${Math.round(altRatio)}%)`);
    } else {
      seoIssues.push(`Usage faible des attributs alt (${Math.round(altRatio)}%) - À améliorer`);
    }
  }

  // Liens
  const urlObj = new URL(url);
  const internalLinks = $('a[href^="/"], a[href*="' + urlObj.hostname + '"]').length;
  const externalLinks = $('a[href^="http"]').not('a[href*="' + urlObj.hostname + '"]').length;
  
  if (internalLinks > 0) {
    seoScore += 10;
    seoGoodPoints.push(`Maillage interne présent (${internalLinks} liens)`);
  } else {
    seoIssues.push('Aucun lien interne - Maillage interne manquant');
  }

  if (externalLinks > 0) {
    seoScore += 5;
    seoGoodPoints.push(`Liens externes présents (${externalLinks})`);
  }

  // Meta robots
  const metaRobots = $('meta[name="robots"]').attr('content');
  if (metaRobots && !metaRobots.includes('noindex')) {
    seoScore += 5;
    seoGoodPoints.push('Meta robots configuré correctement');
  } else if (metaRobots && metaRobots.includes('noindex')) {
    seoIssues.push('Page bloquée par robots (noindex)');
  }

  // Canonical
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical) {
    seoScore += 5;
    seoGoodPoints.push('URL canonique définie');
  } else {
    seoIssues.push('URL canonique manquante - Risque de contenu dupliqué');
  }

  // Open Graph
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDesc = $('meta[property="og:description"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  
  if (ogTitle && ogDesc && ogImage) {
    seoScore += 10;
    seoGoodPoints.push('Métadonnées Open Graph complètes');
  } else if (ogTitle || ogDesc) {
    seoScore += 5;
    seoIssues.push('Métadonnées Open Graph partielles');
  } else {
    seoIssues.push('Métadonnées Open Graph manquantes');
  }

  // Twitter Cards
  const twitterCard = $('meta[name="twitter:card"]').attr('content');
  if (twitterCard) {
    seoScore += 5;
    seoGoodPoints.push('Twitter Card configurée');
  }

  // Schema.org / JSON-LD
  const hasStructuredData = $('script[type="application/ld+json"]').length > 0;
  if (hasStructuredData) {
    seoScore += 10;
    seoGoodPoints.push('Données structurées détectées (JSON-LD)');
  } else {
    seoIssues.push('Données structurées manquantes - Améliore la visibilité');
  }

  // Sitemap
  const hasSitemap = $('link[rel="sitemap"]').length > 0;
  if (hasSitemap) {
    seoScore += 5;
    seoGoodPoints.push('Sitemap déclaré dans le HTML');
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
      h3Count,
      imagesTotal: images.length,
      imagesWithAlt,
      internalLinks,
      externalLinks,
      canonical,
      hasOpenGraph: !!(ogTitle && ogDesc && ogImage),
      hasTwitterCard: !!twitterCard,
      hasStructuredData,
      hasSitemap
    }
  };
}

// Route pour nettoyer le cache
app.delete('/cache', (req, res) => {
  analysisCache.clear();
  res.json({ message: 'Cache nettoyé', timestamp: new Date().toISOString() });
});

// Route de santé pour Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cacheSize: analysisCache.size
  });
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Gestion globale des erreurs
app.use((error, req, res, next) => {
  console.error('Erreur serveur:', error);
  res.status(500).json({ 
    error: 'Erreur interne du serveur',
    timestamp: new Date().toISOString()
  });
});

// Nettoyage périodique du cache (toutes les heures)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of analysisCache.entries()) {
    if (now - value.timestamp > 3600000) { // 1 heure
      analysisCache.delete(key);
    }
  }
  console.log(`Cache nettoyé - Taille actuelle: ${analysisCache.size}`);
}, 3600000);

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Analyseur de Sites Web Avancé démarré sur le port ${PORT}`);
  console.log(`📝 Interface disponible sur http://localhost:${PORT}`);
  console.log(`🔧 API Health Check sur http://localhost:${PORT}/health`);
  console.log(`🌍 Langues supportées: ${Object.keys(LANGUAGES).join(', ')}`);
  console.log(`🤖 User-Agents disponibles: ${Object.keys(USER_AGENTS).length}`);
});

module.exports = app;
