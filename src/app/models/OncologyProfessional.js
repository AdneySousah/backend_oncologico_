import Sequelize, { Model } from 'sequelize';

class OncologyProfessional extends Model {
  static init(sequelize) {
    super.init(
      {
        registry_type: Sequelize.STRING,
        registry_number: Sequelize.STRING,
      },
      {
        sequelize,
        tableName: 'oncology_professionals', // Força o nome se necessário
      }
    );

    return this;
  }

  static associate(models) {
    // Relacionamento: Profissional pertence a um Usuário
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    this.belongsTo(models.Especiality, { foreignKey: 'especiality_id', as: 'speciality' });
  }
}
export default OncologyProfessional;