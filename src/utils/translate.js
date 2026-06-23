const axios = require('axios');

/**
 * Translates a single string into a target language using the free Google Translate API.
 */
async function translateText(text, targetLang) {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return '';
  }

  // Add a small delay between requests to avoid rate limits / overloading
  await new Promise((resolve) => setTimeout(resolve, 80));

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 8000, // 8 seconds timeout to prevent hanging
    });

    if (response.data && response.data[0]) {
      const translated = response.data[0]
        .map((x) => x[0])
        .filter(Boolean)
        .join('');
      return translated;
    }
    return text;
  } catch (error) {
    console.error(`[Translate] Error translating to ${targetLang}:`, error.message);
    return text; // Fallback to original text on failure
  }
}

/**
 * Translates a string to all three target languages: ml, hi, ta sequentially.
 */
async function translateToAll(text) {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return { ml: '', hi: '', ta: '' };
  }
  const ml = await translateText(text, 'ml');
  const hi = await translateText(text, 'hi');
  const ta = await translateText(text, 'ta');
  return { ml, hi, ta };
}

/**
 * Translates an array of strings sequentially.
 */
async function translateArray(arr) {
  if (!Array.isArray(arr)) return [];
  const results = [];
  for (const item of arr) {
    results.push(await translateToAll(item));
  }
  return results;
}

/**
 * Translates howItsDone steps sequentially.
 */
async function translateHowItsDone(steps) {
  if (!Array.isArray(steps)) return [];
  const results = [];
  for (const step of steps) {
    const title = await translateToAll(step.title);
    const description = await translateToAll(step.description);
    results.push({
      title,
      description,
    });
  }
  return results;
}

/**
 * Translates faqs sequentially.
 */
async function translateFaqs(faqs) {
  if (!Array.isArray(faqs)) return [];
  const results = [];
  for (const faq of faqs) {
    const question = await translateToAll(faq.question);
    const answer = await translateToAll(faq.answer);
    results.push({
      question,
      answer,
    });
  }
  return results;
}

/**
 * Main translation handler for a Service object.
 */
async function translateService(service) {
  try {
    const name = await translateToAll(service.name);
    const description = await translateToAll(service.description);
    const whatsIncluded = await translateArray(service.whatsIncluded);
    const doesNotInclude = await translateArray(service.doesNotInclude);
    const howItsDone = await translateHowItsDone(service.howItsDone);
    const faqs = await translateFaqs(service.faqs);

    return {
      name,
      description,
      whatsIncluded,
      doesNotInclude,
      howItsDone,
      faqs,
    };
  } catch (error) {
    console.error('[Translate] Service translation failed:', error.message);
    return null;
  }
}

/**
 * Main translation handler for a HeroBanner object.
 */
async function translateBanner(banner) {
  try {
    const title = await translateToAll(banner.title);
    const subtitle = await translateToAll(banner.subtitle);
    const ctaLabel = await translateToAll(banner.ctaLabel);
    return {
      title,
      subtitle,
      ctaLabel,
    };
  } catch (error) {
    console.error('[Translate] Banner translation failed:', error.message);
    return null;
  }
}

/**
 * Main translation handler for a SplashContent object.
 */
async function translateSplash(splash) {
  try {
    const title = await translateToAll(splash.title);
    const subtitle = await translateToAll(splash.subtitle);
    const ctaLabel = await translateToAll(splash.ctaLabel);
    return {
      title,
      subtitle,
      ctaLabel,
    };
  } catch (error) {
    console.error('[Translate] Splash translation failed:', error.message);
    return null;
  }
}

/**
 * Main translation handler for a FeaturedService object.
 */
async function translateFeaturedService(featured) {
  try {
    const label = await translateToAll(featured.label);
    const highlight = await translateToAll(featured.highlight);
    return {
      label,
      highlight,
    };
  } catch (error) {
    console.error('[Translate] Featured service translation failed:', error.message);
    return null;
  }
}

const mapServiceTranslations = (service, locale) => {
  if (!service) return service;

  const serviceObj = service.toObject ? service.toObject() : { ...service };
  const trans = serviceObj.translations;

  if (locale && locale !== 'en' && trans) {
    if (trans.name && trans.name[locale]) {
      serviceObj.name = trans.name[locale];
    }
    if (trans.description && trans.description[locale]) {
      serviceObj.description = trans.description[locale];
    }
    if (Array.isArray(serviceObj.whatsIncluded) && Array.isArray(trans.whatsIncluded)) {
      serviceObj.whatsIncluded = serviceObj.whatsIncluded.map((item, idx) => {
        return (trans.whatsIncluded[idx] && trans.whatsIncluded[idx][locale]) || item;
      });
    }
    if (Array.isArray(serviceObj.doesNotInclude) && Array.isArray(trans.doesNotInclude)) {
      serviceObj.doesNotInclude = serviceObj.doesNotInclude.map((item, idx) => {
        return (trans.doesNotInclude[idx] && trans.doesNotInclude[idx][locale]) || item;
      });
    }
    if (Array.isArray(serviceObj.howItsDone) && Array.isArray(trans.howItsDone)) {
      serviceObj.howItsDone = serviceObj.howItsDone.map((step, idx) => {
        const stepTrans = trans.howItsDone[idx];
        if (stepTrans) {
          const mappedStep = { ...step };
          if (stepTrans.title && stepTrans.title[locale])
            mappedStep.title = stepTrans.title[locale];
          if (stepTrans.description && stepTrans.description[locale])
            mappedStep.description = stepTrans.description[locale];
          return mappedStep;
        }
        return step;
      });
    }
    if (Array.isArray(serviceObj.faqs) && Array.isArray(trans.faqs)) {
      serviceObj.faqs = serviceObj.faqs.map((faq, idx) => {
        const faqTrans = trans.faqs[idx];
        if (faqTrans) {
          const mappedFaq = { ...faq };
          if (faqTrans.question && faqTrans.question[locale])
            mappedFaq.question = faqTrans.question[locale];
          if (faqTrans.answer && faqTrans.answer[locale])
            mappedFaq.answer = faqTrans.answer[locale];
          return mappedFaq;
        }
        return faq;
      });
    }
  }

  // Always remove the raw translations block to prevent sending other languages
  if (serviceObj.translations !== undefined) {
    delete serviceObj.translations;
  }
  return serviceObj;
};

const mapContentTranslations = (item, locale, type) => {
  if (!item) return item;

  const itemObj = item.toObject ? item.toObject() : { ...item };
  const trans = itemObj.translations;

  if (locale && locale !== 'en' && trans) {
    if (type === 'banner' || type === 'splash') {
      if (trans.title && trans.title[locale]) itemObj.title = trans.title[locale];
      if (trans.subtitle && trans.subtitle[locale]) itemObj.subtitle = trans.subtitle[locale];
      if (trans.ctaLabel && trans.ctaLabel[locale]) itemObj.ctaLabel = trans.ctaLabel[locale];
    } else if (type === 'featured') {
      if (trans.label && trans.label[locale]) itemObj.label = trans.label[locale];
      if (trans.highlight && trans.highlight[locale]) itemObj.highlight = trans.highlight[locale];
    } else if (type === 'trust') {
      if (trans.title && trans.title[locale]) itemObj.title = trans.title[locale];
    } else if (type === 'footer') {
      if (trans.title && trans.title[locale]) itemObj.title = trans.title[locale];
      if (trans.subtitle && trans.subtitle[locale]) itemObj.subtitle = trans.subtitle[locale];
    }
  }

  // Always remove the raw translations block to prevent sending other languages
  if (itemObj.translations !== undefined) {
    delete itemObj.translations;
  }
  return itemObj;
};

/**
 * Main translation handler for a TrustCard object.
 */
async function translateTrust(trust) {
  try {
    const title = await translateToAll(trust.title);
    return { title };
  } catch (error) {
    console.error('[Translate] Trust card translation failed:', error.message);
    return null;
  }
}

/**
 * Main translation handler for a FooterBanner object.
 */
async function translateFooter(footer) {
  try {
    const title = await translateToAll(footer.title);
    const subtitle = await translateToAll(footer.subtitle);
    return { title, subtitle };
  } catch (error) {
    console.error('[Translate] Footer banner translation failed:', error.message);
    return null;
  }
}

module.exports = {
  translateText,
  translateToAll,
  translateArray,
  translateService,
  translateBanner,
  translateSplash,
  translateFeaturedService,
  translateTrust,
  translateFooter,
  mapServiceTranslations,
  mapContentTranslations,
};
