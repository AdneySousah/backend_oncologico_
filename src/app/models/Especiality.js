import Sequelize, { Model } from 'sequelize';

class Especiality extends Model {
  static init(sequelize) {
    super.init(
      {
        name: Sequelize.STRING,
  
      },
      {
        sequelize,
        tableName: 'specialities', // Força o nome se necessário
      }
    );

    return this;
  }


}

export default Especiality;