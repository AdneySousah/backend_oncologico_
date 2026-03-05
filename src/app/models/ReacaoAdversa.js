import Sequelize, { Model } from 'sequelize';

class ReacaoAdversa extends Model {
  static init(sequelize) {
    super.init(
      {
        name: Sequelize.STRING,
      },
      {
        sequelize,
        tableName: 'reacao_adversa', // Força o nome se necessário
      }
    );

    return this;
  }

  static associate(models) {
    // Agora é um relacionamento de muitos para muitos
    this.belongsToMany(models.MonitoramentoMedicamento, { 
      through: 'monitoramento_reacoes_adversas',
      foreignKey: 'reacao_adversa_id', 
      as: 'monitoramentos' 
    });
  }
}

export default ReacaoAdversa;