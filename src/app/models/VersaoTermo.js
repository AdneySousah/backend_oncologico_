import Sequelize, { Model } from 'sequelize';

// Versão do texto do termo de aceite. Cada paciente que aceita fica
// vinculado à versão vigente no momento (Pacientes.termo_versao_id) — o PDF
// gerado ao vivo pra esse paciente sempre usa essa versão, não a mais
// recente, preservando o texto real que ele viu ao aceitar.
class VersaoTermo extends Model {
  static init(sequelize) {
    super.init({
      titulo: Sequelize.STRING,
      conteudo: Sequelize.JSONB,
      ativo: Sequelize.BOOLEAN,
    }, {
      sequelize,
      tableName: 'versoes_termo',
    });
    return this;
  }

  static associate(models) {
    this.belongsTo(models.User, { foreignKey: 'criado_por', as: 'criador' });
    this.hasMany(models.Pacientes, { foreignKey: 'termo_versao_id', as: 'pacientes' });
  }
}

export default VersaoTermo;
