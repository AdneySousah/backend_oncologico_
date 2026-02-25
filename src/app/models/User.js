import Sequelize, { Model } from 'sequelize';
import bcrypt from 'bcrypt'; // Importe o bcrypt se ainda não tiver

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
        is_new_user: Sequelize.BOOLEAN, // ADICIONADO AQUI
      },
      {
        sequelize,
        tableName: 'users',
      }
    );

    return this;
  }

  // Método auxiliar para verificar a senha (útil para a troca de senha)
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
    this.hasOne(models.OncologyProfessional, { foreignKey: 'user_id', as: 'professional' }); // Relacionamento com Profissional
  }


    



}

export default User;