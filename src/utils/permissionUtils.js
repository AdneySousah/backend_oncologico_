import { Op } from 'sequelize';
import User from '../app/models/User.js'; 
import Operadora from '../app/models/Operadora.js'; 

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
        const temAcessoGlobal = user.operadoras.some(op => {
            const nomeOperadora = op.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "").trim();
            // Verifica o nome exato sem acentos e minúsculo: 'clinica de infusao compartilhada'
            return nomeOperadora === 'clinica de infusao compartilhada';
        });
        
        let whereClause = {};

        // Se for admin ou tiver a "Clinica" (Acesso Global)
        if (user.is_admin || temAcessoGlobal) {
            console.log('Usuário com acesso global. Permissões completas concedidas.');
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