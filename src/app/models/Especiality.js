import Sequelize, { Model } from 'sequelize';

class Especiality extends Model {
  static init(sequelize) {
    super.init(
      {
        name: Sequelize.STRING,
        active: Sequelize.BOOLEAN,
  
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