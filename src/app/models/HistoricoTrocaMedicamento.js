import Sequelize, { Model } from 'sequelize';

class HistoricoTrocaMedicamento extends Model {
  static init(sequelize) {
    super.init({
      data_troca: Sequelize.DATEONLY,
    }, {
      sequelize,
      tableName: 'historico_troca_medicamentos',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_antigo_id', as: 'medicamentoAntigo' });
    this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_novo_id', as: 'medicamentoNovo' });
    this.belongsTo(models.MonitoramentoMedicamento, { foreignKey: 'monitoramento_id', as: 'monitoramento' });
  }
}

export default HistoricoTrocaMedicamento;