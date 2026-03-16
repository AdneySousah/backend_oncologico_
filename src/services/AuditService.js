import AuditLog from '../app/models/AuditLog.js';

class AuditService {
  /**
   * Grava um log de auditoria no sistema
   * @param {number} userId - ID do usuário logado (req.userId)
   * @param {string} actionType - 'Criação', 'Edição', 'Exclusão', 'Emissão', 'Envio', 'Acesso'
   * @param {string} entity - 'Paciente', 'Avaliação', 'Termo', 'Dashboard', etc.
   * @param {number|null} entityId - ID do registro afetado (se houver)
   * @param {string} details - Detalhes traduzidos da ação
   */
  static async log(userId, actionType, entity, entityId = null, details = '') {
    try {
      await AuditLog.create({
        user_id: userId,
        action_type: actionType,
        entity,
        entity_id: entityId,
        details
      });
    } catch (error) {
      // Usamos apenas um console.error para não quebrar a aplicação original caso o log falhe
      console.error('Falha ao registrar log de auditoria:', error);
    }
  }
}

export default AuditService;