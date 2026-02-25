import Sequelize, { Model } from 'sequelize';

class MonitoramentoMedicamento extends Model {
  static init(sequelize) {
    super.init({
      posologia_diaria: Sequelize.INTEGER,
      data_calculada_fim_caixa: Sequelize.DATEONLY,
      data_proximo_contato: Sequelize.DATEONLY,
      status: Sequelize.ENUM('PENDENTE', 'CONCLUIDO', 'CANCELADO'),
      tomando_corretamente: Sequelize.BOOLEAN,
      qtd_informada_caixa: Sequelize.INTEGER,
      data_abertura_nova_caixa: Sequelize.DATEONLY,
      is_reacao: Sequelize.BOOLEAN,
      contato_efetivo: Sequelize.BOOLEAN,
      adesao_tratamento: Sequelize.BOOLEAN,
      nivel_adesao: Sequelize.STRING,
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

    this.belongsTo(models.ReacaoAdversa, { foreignKey: 'reacao_adversa_id', as: 'reacaoAdversa' });
  }
}

export default MonitoramentoMedicamento;