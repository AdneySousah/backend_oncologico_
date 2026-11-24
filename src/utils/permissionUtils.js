import { Op } from 'sequelize';
import User from '../app/models/User.js'; 
import Operadora from '../app/models/Operadora.js'; 
import Pacientes from '../app/models/Pacientes.js';
import MonitoramentoMedicamento from '../app/models/MonitoramentoMedicamento.js';

// Operadoras com acesso a TODOS os pacientes. O login e a sincronização renomeiam a
// "Clínica de Infusão Compartilhada" para "CICFARMA", então os dois nomes valem.
const OPERADORAS_ACESSO_GLOBAL = ['clinica de infusao compartilhada', 'cicfarma'];

function normalizarNome(nome) {
    return String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Função para gerar a cláusula 'where' baseada nas permissões da operadora do usuário.
 * @param {number} userId - ID do usuário logado (req.userId)
 * @param {number} [operadoraQueryId] - (Opcional) ID da operadora vindo da query da URL
 * @returns {Object} Retorna o status de autorização e o objeto 'where' para o Sequelize
 */
export async function getOperadoraFilter(userId, operadoraQueryId = null) {
    try {
        const user = await User.findByPk(userId, {
            include: [{
                model: Operadora,
                as: 'operadoras',
                attributes: ['id', 'nome']
            }]
        });

        if (!user) {
            return { authorized: false, status: 401, error: 'Usuário não autorizado.' };
        }

        const allowedOperadorasIds = user.operadoras.map(op => op.id);
        
        // CORREÇÃO AQUI: Tratando acentos e o nome correto que está no banco
        const temAcessoGlobal = user.operadoras.some(op => OPERADORAS_ACESSO_GLOBAL.includes(normalizarNome(op.nome)));
        
        let whereClause = {};

        // Se for admin ou tiver a "Clinica" (Acesso Global)
        if (user.is_admin || temAcessoGlobal) {
            if (operadoraQueryId) {
                whereClause.operadora_id = operadoraQueryId;
            }
            // Se não passou query, whereClause continua vazio {}, logo, traz tudo.
        } 
        // Se NÃO for admin e NÃO tiver "Clinica" (Acesso Restrito)
        else {
            if (allowedOperadorasIds.length === 0) {
                return { authorized: false, status: 403, error: 'Usuário sem operadoras vinculadas.', emptyResult: true };
            }

            if (operadoraQueryId) {
                if (allowedOperadorasIds.includes(Number(operadoraQueryId))) {
                    whereClause.operadora_id = operadoraQueryId;
                } else {
                    return { authorized: false, status: 403, error: 'Acesso negado a esta operadora.' };
                }
            } else {
                whereClause.operadora_id = {
                    [Op.in]: allowedOperadorasIds 
                };
            }
        }

        return { authorized: true, whereClause };

    } catch (err) {
        console.error("Erro no utilitário de permissão:", err);
        return { authorized: false, status: 500, error: 'Erro interno ao verificar permissões.' };
    }
}

// =====================================================================
// Acesso por id: o paciente (ou o ciclo dele) precisa ser de uma operadora
// do usuário. Antes só as listagens filtravam por operadora; trocando o id
// na URL era possível ler/alterar pacientes de outra operadora.
// =====================================================================

// null = acesso a todas as operadoras; array = ids permitidos
export async function operadorasPermitidas(userId) {
    const user = await User.findByPk(userId, {
        include: [{ model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] }]
    });
    if (!user) return [];
    if (user.is_admin || user.operadoras.some(op => OPERADORAS_ACESSO_GLOBAL.includes(normalizarNome(op.nome)))) return null;
    return user.operadoras.map(op => op.id);
}

// Id aceito só no formato canônico: inteiro positivo (número ou texto só com dígitos).
// Antes um valor fora do padrão (ex.: "+5", " 5", [5]) era ignorado aqui e seguia para o
// controller — e o Postgres converte "+5" em 5, o que furava a checagem de operadora.
function idCanonico(valor) {
    if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor > 0;
    return typeof valor === 'string' && /^\d{1,15}$/.test(valor) && Number(valor) > 0;
}

function idInvalido(res) {
    return res.status(400).json({ error: 'Identificador inválido.' });
}

// Rotas com :id numérico que não passam pelas travas de operadora: id fora do padrão
// (ex.: "abc") virava erro 500 do banco; agora responde 400.
export function exigirIdNumerico(param = 'id') {
    return (req, res, next) => (idCanonico(req.params?.[param]) ? next() : idInvalido(res));
}

async function pacientesForaDaOperadora(userId, pacienteIds) {
    const permitidas = await operadorasPermitidas(userId);
    if (permitidas === null) return false;
    const ids = [...new Set(pacienteIds.filter(id => /^\d+$/.test(String(id))).map(Number))];
    if (!ids.length) return false;
    const pacientes = await Pacientes.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'operadora_id'] });
    // Paciente inexistente segue para o controller (que responde 404).
    return pacientes.some(p => !permitidas.includes(p.operadora_id));
}

function negar(res) {
    return res.status(403).json({ error: 'Você não tem acesso a este paciente (pertence a outra operadora).' });
}

// Paciente identificado por req.params[param] ou req.body[param]
export function exigirPacienteDaOperadora(param = 'id', origem = 'params') {
    return async (req, res, next) => {
        try {
            const valor = req[origem]?.[param];
            if (valor === undefined || valor === null || valor === '') return next();
            if (!idCanonico(valor)) return idInvalido(res);
            if (await pacientesForaDaOperadora(req.userId, [valor])) return negar(res);
            return next();
        } catch (err) {
            console.error('Erro ao verificar operadora do paciente:', err);
            return res.status(500).json({ error: 'Erro interno ao validar o acesso ao paciente.' });
        }
    };
}

// Ciclo(s) de monitoramento: por req.params.id ou por uma função que extrai os ids do req
export function exigirMonitoramentoDaOperadora(extrairIds = (req) => [req.params.id]) {
    return async (req, res, next) => {
        try {
            const brutos = extrairIds(req) || [];
            if (brutos.some(id => !idCanonico(id))) return idInvalido(res);
            const ids = brutos.map(Number);
            if (!ids.length) return next();
            const ciclos = await MonitoramentoMedicamento.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'paciente_id'] });
            if (await pacientesForaDaOperadora(req.userId, ciclos.map(c => c.paciente_id))) return negar(res);
            return next();
        } catch (err) {
            console.error('Erro ao verificar operadora do monitoramento:', err);
            return res.status(500).json({ error: 'Erro interno ao validar o acesso ao paciente.' });
        }
    };
}
