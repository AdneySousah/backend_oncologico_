import crypto from 'node:crypto';
import Pacientes from '../app/models/Pacientes.js';

// Link público do termo de aceite.
//
// Antes o link era /paciente/termo/<id do paciente> e qualquer pessoa podia trocar o
// número para ver o PDF (nome/CPF) ou responder o termo de outro paciente. Agora o link
// leva um token aleatório gerado no envio (pacientes.termo_token).
//
// Links ANTIGOS (com o id numérico) já enviados por WhatsApp/e-mail continuam abrindo
// só durante a transição, e só para quem ainda está com o termo Pendente e nunca recebeu
// link com token. Depois de LINKS_ANTIGOS_ATE, o id numérico não abre mais nada.
export const LINKS_ANTIGOS_ATE = new Date('2026-12-16T23:59:59-03:00');

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{24,64}$/;

export function gerarTokenTermo() {
  return crypto.randomBytes(24).toString('base64url'); // 32 caracteres
}

// Garante um token para o paciente: reaproveita o atual enquanto o termo está Pendente
// (assim o envio para o cuidador não invalida o link já enviado ao paciente); gera um
// novo em qualquer outra situação (primeiro envio, reenvio após resposta/cancelamento).
export function prepararTokenTermo(paciente) {
  if (!(paciente.termo_token && paciente.status_termo === 'Pendente')) {
    paciente.termo_token = gerarTokenTermo();
  }
  return paciente.termo_token;
}

export function montarLinkTermo(paciente) {
  const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
  return `${frontUrl}/paciente/termo/${paciente.termo_token}`;
}

// Resolve o parâmetro da URL pública (token novo ou id antigo) para o paciente.
// Retorna null quando o link não é válido.
export async function buscarPacientePorLinkTermo(chave, opcoes = {}) {
  const valor = String(chave || '');

  if (TOKEN_VALIDO.test(valor) && !/^\d+$/.test(valor)) {
    return Pacientes.findOne({ ...opcoes, where: { termo_token: valor } });
  }

  if (/^\d+$/.test(valor) && new Date() <= LINKS_ANTIGOS_ATE) {
    const paciente = await Pacientes.findOne({
      ...opcoes,
      where: { id: Number(valor), termo_token: null, status_termo: 'Pendente' },
    });
    return paciente;
  }

  return null;
}
