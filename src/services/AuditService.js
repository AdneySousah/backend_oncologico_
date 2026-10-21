import AuditLog from '../app/models/AuditLog.js';
import MonitoramentoMedicamento from '../app/models/MonitoramentoMedicamento.js';
import PatientEvaluation from '../app/models/PatientEvaluation.js';
import Conversation from '../app/models/Conversation.js';

// 👇 NOVO: descobre o paciente afetado a partir da entidade/entity_id quando
// o chamador não informou — mesma regra do backfill da migration
// add-paciente-id-to-audit-logs. Assim as chamadas antigas passam a gravar
// "para quem" sem precisar ser reescritas.
const resolverPacienteId = async (entity, entityId) => {
  if (!entityId) return null;
  const nome = String(entity || '');
  try {
    if (nome === 'Monitoramento') {
      const m = await MonitoramentoMedicamento.findByPk(entityId, { attributes: ['paciente_id'] });
      return m ? m.paciente_id : null;
    }
    if (nome === 'Pacientes' || nome === 'Paciente' || nome === 'NPS' || nome.startsWith('NPS ') || (nome.startsWith('Termo') && nome !== 'Versão do Termo')) {
      return Number(entityId);
    }
    if (nome === 'Entrevista/Avaliação') {
      const e = await PatientEvaluation.findByPk(entityId, { attributes: ['paciente_id'] });
      return e ? e.paciente_id : null;
    }
    if (nome === 'Chat') {
      const c = await Conversation.findByPk(entityId, { attributes: ['paciente_id'] });
      return c ? c.paciente_id : null;
    }
  } catch (error) {
    console.error('Falha ao resolver paciente do log de auditoria:', error);
  }
  return null;
};

class AuditService {
  /**
   * Grava um log de auditoria no sistema
   * @param {number} userId - ID do usuário logado (req.userId)
   * @param {string} actionType - 'Criação', 'Edição', 'Exclusão', 'Emissão', 'Envio', 'Acesso', 'Sincronização', 'Inserção Manual'
   * @param {string} entity - 'Paciente', 'Avaliação', 'Termo', 'Dashboard', etc.
   * @param {number|null} entityId - ID do registro afetado (se houver)
   * @param {string} details - Detalhes traduzidos da ação
   * @param {number|null} pacienteId - 👈 NOVO: paciente afetado; se omitido, é deduzido de entity/entityId
   */
  static async log(userId, actionType, entity, entityId = null, details = '', pacienteId = null) {
    try {
      const paciente_id = pacienteId ?? await resolverPacienteId(entity, entityId);
      await AuditLog.create({
        user_id: userId,
        action_type: actionType,
        entity,
        entity_id: entityId,
        details,
        paciente_id
      });
    } catch (error) {
      // Usamos apenas um console.error para não quebrar a aplicação original caso o log falhe
      console.error('Falha ao registrar log de auditoria:', error);
    }
  }
}

export default AuditService;