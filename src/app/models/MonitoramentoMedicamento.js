import Sequelize, { Model } from 'sequelize';

class MonitoramentoMedicamento extends Model {
  static init(sequelize) {
    super.init({
      posologia_diaria: Sequelize.INTEGER,
      data_calculada_fim_caixa: Sequelize.DATEONLY,
      data_proximo_contato: Sequelize.DATEONLY,
      status: Sequelize.ENUM('PENDENTE', 'CONCLUIDO', 'CANCELADO', 'DESCONTINUADO'),
      qtd_informada_caixa: Sequelize.INTEGER,
      data_abertura_nova_caixa: Sequelize.DATEONLY,
      is_reacao: Sequelize.BOOLEAN,
      contato_efetivo: Sequelize.BOOLEAN,
      nivel_adesao: Sequelize.STRING,
      observacao: Sequelize.TEXT,
      data_entrega: Sequelize.DATEONLY,
      data_administracao: Sequelize.DATEONLY,

      data_telemonitoramento_efetivado: Sequelize.DATE,

      qtd_caixas: Sequelize.INTEGER,
      qtd_total_capsulas: Sequelize.INTEGER,
      evento_externo_id: Sequelize.INTEGER,

      mudou_posologia: Sequelize.BOOLEAN,
      nova_posologia: Sequelize.INTEGER,
      data_mudanca_posologia: Sequelize.DATEONLY,
      grupo_medicamentos_id: Sequelize.STRING,
      retomado_de_monitoramento_id: Sequelize.INTEGER,

      // 👇 NOVO: marca o ciclo cuja "compra" veio de um evento de reembolso
      // criado manualmente (paciente comprou por conta própria e foi
      // reembolsado pela operadora, sem sincronizar com o sistema externo).
      // Usado pelo faturamento pra excluir esse ciclo específico da cobrança.
      eh_reembolso: Sequelize.BOOLEAN,

      // 👇 CORREÇÃO: esta coluna já existia no banco (migration
      // add-descontinuado-status-to-monitoramento_medicamentos) mas nunca
      // tinha sido declarada aqui — o Sequelize descartava o valor
      // silenciosamente em todo update() que tentava gravar o motivo de
      // descontinuação em texto livre.
      motivo_encerramento: Sequelize.TEXT,
      // 👇 NOVO: motivo estruturado (mesma tabela usada em "Pausar
      // Tratamento"), pra permitir contabilizar motivos de forma consistente.
      motivo_encerramento_id: Sequelize.INTEGER

    }, {
      sequelize,
      tableName: 'monitoramento_medicamentos',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    this.belongsTo(models.EntrevistaMedica, { foreignKey: 'entrevista_profissional_id', as: 'entrevista' });
    this.belongsTo(models.PatientEvaluation, { foreignKey: 'patient_evaluation_id', as: 'avaliacao' });
    this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento' });

    this.belongsTo(models.MotivoFalhaContato, { foreignKey: 'motivo_falha_contato_id', as: 'motivoFalhaContato' });
    this.belongsTo(models.MotivoPausaTratamento, { foreignKey: 'motivo_encerramento_id', as: 'motivoEncerramento' });
    this.belongsTo(models.MonitoramentoMedicamento, { foreignKey: 'retomado_de_monitoramento_id', as: 'retomadoDe' });

    this.belongsToMany(models.ReacaoAdversa, {
      through: 'monitoramento_reacoes_adversas',
      foreignKey: 'monitoramento_id',
      as: 'reacoesAdversas'
    });
  }
}

export default MonitoramentoMedicamento;