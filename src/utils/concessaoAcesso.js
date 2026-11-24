import User from '../app/models/User.js';
import Perfil from '../app/models/Perfil.js';
import Operadora from '../app/models/Operadora.js';
import { operadorasPermitidas } from './permissionUtils.js';

// =====================================================================
// Quem pode conceder acesso (telas Usuários e Permissões).
// Antes, qualquer pessoa com "usuarios > editar" podia se tornar administradora,
// trocar o próprio perfil, ligar-se a qualquer operadora e reescrever as
// permissões de qualquer perfil. Regra agora:
// - administrador (is_admin) continua podendo tudo;
// - quem não é administrador só concede o que ele mesmo tem: perfil com
//   permissões contidas nas suas e operadoras às quais também tem acesso;
// - não mexe em administradores, no acesso de administrador, no próprio
//   perfil/operadoras, nem no perfil usado por administradores.
// =====================================================================

const negado = (error) => ({ status: 403, error });

async function carregarSolicitante(userId) {
    return User.findByPk(userId, { include: [{ model: Perfil, as: 'perfil' }] });
}

// Toda ação marcada em "alvo" também está marcada em "base".
export function permissoesContidas(alvo, base) {
    const b = base || {};
    return Object.entries(alvo || {}).every(([modulo, acoes]) =>
        Object.entries(acoes || {}).every(([acao, valor]) => valor !== true || b[modulo]?.[acao] === true)
    );
}

const mesmoConjunto = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// alvo = usuário sendo editado (null na criação). dados = corpo da requisição.
// Retorna null (pode) ou { status, error }.
export async function verificarConcessaoUsuario(userId, alvo, dados) {
    const solicitante = await carregarSolicitante(userId);
    if (!solicitante) return { status: 401, error: 'Usuário não encontrado.' };
    if (solicitante.is_admin) return null;

    if (alvo?.is_admin) return negado('Apenas administradores podem alterar um usuário administrador.');

    if (dados.is_admin !== undefined && !!dados.is_admin !== !!alvo?.is_admin) {
        return negado('Apenas administradores podem conceder ou retirar o acesso de administrador.');
    }

    const proprio = alvo && alvo.id === solicitante.id;

    const perfilNovo = dados.perfil_id;
    if (perfilNovo !== undefined && perfilNovo !== null && Number(perfilNovo) !== Number(alvo?.perfil_id)) {
        if (proprio) return negado('Você não pode alterar o próprio perfil de acesso.');
        const perfil = await Perfil.findByPk(perfilNovo);
        if (!perfil) return { status: 400, error: 'Perfil de acesso não encontrado.' };
        if (!permissoesContidas(perfil.permissoes, solicitante.perfil?.permissoes)) {
            return negado('Você não pode atribuir um perfil com mais permissões do que o seu.');
        }
    }

    if (Array.isArray(dados.operadoras)) {
        const novas = dados.operadoras.map(Number);
        let atuais = [];
        if (alvo) {
            const comOperadoras = await User.findByPk(alvo.id, { include: [{ model: Operadora, as: 'operadoras', attributes: ['id'] }] });
            atuais = (comOperadoras?.operadoras || []).map((o) => o.id);
        }
        if (!mesmoConjunto(novas, atuais)) {
            if (proprio) return negado('Você não pode alterar as próprias operadoras.');
            const permitidas = await operadorasPermitidas(solicitante.id);
            if (permitidas !== null && novas.some((id) => !permitidas.includes(id))) {
                return negado('Você só pode vincular operadoras às quais também tem acesso.');
            }
        }
    }

    return null;
}

// perfilAtual = perfil sendo editado (null na criação); permissoes = as novas (ou undefined).
export async function verificarConcessaoPerfil(userId, perfilAtual, permissoes) {
    const solicitante = await carregarSolicitante(userId);
    if (!solicitante) return { status: 401, error: 'Usuário não encontrado.' };
    if (solicitante.is_admin) return null;

    if (perfilAtual) {
        const usadoPorAdmin = await User.count({ where: { perfil_id: perfilAtual.id, is_admin: true } });
        if (usadoPorAdmin > 0) return negado('Apenas administradores podem alterar o perfil usado por administradores.');
    }

    if (permissoes !== undefined && !permissoesContidas(permissoes, solicitante.perfil?.permissoes)) {
        return negado('Você não pode dar a um perfil mais permissões do que as suas.');
    }

    return null;
}
