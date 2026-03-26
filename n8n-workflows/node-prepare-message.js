// Node: Prepare_message (Code node, mode: runOnceForEachItem)
// Remplace l'ancien node qui utilisait des variantes génériques
// Maintenant : si un bien est trouvé → message basé sur le bien, sinon → fallback générique

const city = ($json.agency_city || 'votre secteur').replace(/\s*\(.*\)/, '').trim();
const listing = $json.listing_title;
const price = $json.listing_price;

if (listing && listing !== 'NON_TROUVE' && listing !== 'SKIP' && price && price !== 'NON_TROUVE') {

  // --- MODE BIEN TROUVÉ ---
  const variantes = [
    `Bonjour, j'ai vu votre annonce "${listing}" à ${price}, c'est toujours disponible ?`,
    `Bonjour, je suis intéressé par votre bien "${listing}" affiché à ${price}, il est encore en vente ?`,
    `Bonjour, votre "${listing}" à ${price} a retenu mon attention, c'est toujours d'actualité ?`,
    `Bonjour, je cherche sur ${city} et j'ai repéré votre "${listing}" à ${price}, il est toujours disponible ?`,
    `Bonjour, est-ce que votre "${listing}" à ${price} est encore disponible ? Je cherche activement sur ${city}.`,
    `Bonjour, je suis tombé sur votre annonce "${listing}" à ${price} sur ${city}, c'est encore en vente ?`,
  ];

  const sujets = [
    `${listing}`,
    `Votre bien à ${price}`,
    `Disponibilité bien - ${city}`,
    `Votre annonce sur ${city}`,
    `Question sur votre bien à ${price}`,
    `Recherche sur ${city}`,
  ];

  const variante = variantes[Math.floor(Math.random() * variantes.length)];
  const sujet = sujets[Math.floor(Math.random() * sujets.length)];

  return {
    ...$json,
    email_subject: sujet,
    email_body: variante + '\n\nNoam'
  };

} else {

  // --- FALLBACK GÉNÉRIQUE (ancien comportement) ---
  const variantes = [
    `Bonjour, vous êtes bien situé à ${city} ? Je commence à chercher dans le secteur.`,
    `Bonjour, je vais être muté sur ${city} prochainement, vous couvrez bien ce secteur ?`,
    `Bonjour, je prépare un déménagement sur ${city}, vous êtes bien implanté dans le coin ?`,
    `Bonjour, je vais m'installer sur ${city} dans les prochains mois, c'est bien votre secteur ?`,
    `Bonjour, on m'a conseillé votre agence pour une recherche sur ${city}, vous êtes bien basé là-bas ?`,
    `Bonjour, je commence à regarder pour m'installer sur ${city}, vous travaillez bien sur ce secteur ?`,
  ];

  const sujets = [
    `Recherche sur ${city}`,
    `Recherche immobilière - ${city}`,
    `Question sur votre secteur`,
    `Installation sur ${city}`,
    `Demande d'info - ${city}`,
    `Votre agence couvre ${city} ?`,
  ];

  const variante = variantes[Math.floor(Math.random() * variantes.length)];
  const sujet = sujets[Math.floor(Math.random() * sujets.length)];

  return {
    ...$json,
    email_subject: sujet,
    email_body: variante + '\n\nNoam'
  };
}
