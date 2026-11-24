// Comparação de telefones brasileiros vindos do WhatsApp (Twilio) com o cadastro.
//
// O WhatsApp às vezes entrega o celular SEM o nono dígito (contas antigas), por isso a
// comparação usa os 8 últimos dígitos. Antes era SÓ isso, e números de DDDs diferentes
// com o mesmo final caíam no paciente errado. Agora o DDD também precisa bater.

function soDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

// { ddd: '31' | null, final8: '99990000' | null }
export function chaveTelefoneBR(valor) {
  let d = soDigitos(String(valor || '').replace('whatsapp:', ''));
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); // tira o código do país
  if (d.length < 8) return { ddd: null, final8: null };
  return {
    ddd: d.length >= 10 ? d.slice(0, 2) : null,
    final8: d.slice(-8),
  };
}

// Mesmo final e mesmo DDD (se um dos lados não tiver DDD, aceita só pelo final).
export function mesmoTelefoneBR(a, b) {
  const ca = chaveTelefoneBR(a);
  const cb = chaveTelefoneBR(b);
  if (!ca.final8 || ca.final8 !== cb.final8) return false;
  if (ca.ddd && cb.ddd) return ca.ddd === cb.ddd;
  return true;
}
