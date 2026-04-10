import Sequelize, { Model } from 'sequelize';
import bcrypt from 'bcrypt';

class User extends Model {
  static init(sequelize) {
    super.init(
      {
        name: Sequelize.STRING,
        email: Sequelize.STRING,
        password_hash: Sequelize.STRING,
        active: Sequelize.BOOLEAN,
        is_profissional: Sequelize.BOOLEAN,
        is_admin: Sequelize.BOOLEAN,
        is_new_user: Sequelize.BOOLEAN,
        reset_password_token: Sequelize.STRING, // ADICIONADO
        reset_password_expires: Sequelize.DATE, // ADICIONADO
        username: Sequelize.STRING,
        external_id: Sequelize.INTEGER,
        external_token: Sequelize.TEXT,
      },
      {
        sequelize,
        tableName: 'users',
      }
    );

    return this;
  }

  checkPassword(password) {
    return bcrypt.compare(password, this.password_hash);
  }

  static associate(models) {
    this.belongsToMany(models.Operadora, {
      through: 'user_operadoras',
      foreignKey: 'user_id',
      as: 'operadoras', 
    });
    this.belongsTo(models.Perfil, { foreignKey: 'perfil_id', as: 'perfil' });
    this.hasOne(models.OncologyProfessional, { foreignKey: 'user_id', as: 'professional' });
  }
}

export default User;