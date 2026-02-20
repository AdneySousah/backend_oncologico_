import Sequelize, { Model } from 'sequelize';

class Perfil extends Model {
  static init(sequelize) {
    super.init(
      {
        nome: Sequelize.STRING,
        permissoes: Sequelize.JSONB,
      },
      {
        sequelize,
        tableName: 'perfis',
      }
    );

    return this;
  }

  static associate(models) {
    // Um perfil pode ter vários usuários
    this.hasMany(models.User, { foreignKey: 'perfil_id', as: 'usuarios' });
  }
}

export default Perfil;