import Sequelize, { Model } from 'sequelize';

// Quem marcou/desmarcou "acumular sobras" num medicamento do paciente, quando e por quê.
class MonitoramentoAcumuloHistorico extends Model {
  static init(sequelize) {
    super.init({
      ativado: Sequelize.BOOLEAN,
      motivo: Sequelize.TEXT
    }, {
      sequelize,
      tableName: 'monitoramento_acumulo_historico',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    this.belongsTo(models.MonitoramentoMedicamento, { foreignKey: 'monitoramento_id', as: 'monitoramento' });
    this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento' });
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'usuario' });
  }
}

export default MonitoramentoAcumuloHistorico;
