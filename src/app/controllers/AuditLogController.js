import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { Op } from 'sequelize';

class AuditLogController {
  async index(req, res) {
    // 1. Extraindo os novos parâmetros (entity e action_type)
    const { user_id, data_inicio, data_fim, entity, action_type, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};

    // Filtro por Usuário
    if (user_id) {
      whereClause.user_id = user_id;
    }

    // Filtro por Data
    if (data_inicio && data_fim) {
      const start = new Date(`${data_inicio}T00:00:00.000Z`);
      const end = new Date(`${data_fim}T23:59:59.999Z`);
      whereClause.createdAt = {
        [Op.between]: [start, end]
      };
    } else if (data_inicio) {
      whereClause.createdAt = { [Op.gte]: new Date(`${data_inicio}T00:00:00.000Z`) };
    } else if (data_fim) {
      // Adicionado caso o usuário preencha só a data final
      whereClause.createdAt = { [Op.lte]: new Date(`${data_fim}T23:59:59.999Z`) }; 
    }

    // 2. Filtro por Módulo (entity) - Busca parcial
    if (entity) {
      whereClause.entity = {
        [Op.like]: `%${entity}%` // NOTA: Se o seu banco for PostgreSQL, use Op.iLike para ignorar maiúsculas/minúsculas
      };
    }

    // 3. Filtro por Tipo de Ação (action_type) - Busca exata
    if (action_type) {
      whereClause.action_type = action_type;
    }

    try {
      const { count, rows: logs } = await AuditLog.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: 'usuario',
            attributes: ['id', 'name', 'email'] // Retorna o nome do usuário para o Front
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      return res.json({
        data: logs,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page)
      });

    } catch (error) {
      console.error("Erro ao buscar logs de auditoria:", error);
      return res.status(500).json({ error: 'Erro ao buscar rastreio do sistema' });
    }
  }
}

export default new AuditLogController();