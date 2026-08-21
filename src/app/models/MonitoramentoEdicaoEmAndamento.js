import Sequelize, { Model } from 'sequelize';

class MonitoramentoEdicaoEmAndamento extends Model {
  static init(sequelize) {
    super.init({
      paciente_id: Sequelize.INTEGER,
      user_id: Sequelize.INTEGER,
      iniciado_em: Sequelize.DATE,
      expira_em: Sequelize.DATE,
    }, {
      sequelize,
      tableName: 'monitoramento_edicoes_em_andamento',
    });
    return this;
  }
  static associate(models) {
    this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'usuario' });
  }
}
export default MonitoramentoEdicaoEmAndamento;