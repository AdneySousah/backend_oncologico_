import Sequelize, { Model } from 'sequelize';

class MotivoFalhaContato extends Model {
  static init(sequelize) {
    super.init({
      descricao: Sequelize.STRING,
      ativo: Sequelize.BOOLEAN,
    }, {
      sequelize,
      tableName: 'motivos_falha_contato',
    });
    return this;
  }
}

export default MotivoFalhaContato;