
import Sequelize, {Model} from 'sequelize';

class Operadora extends Model {
    static init(sequelize){
        super.init({
            nome: Sequelize.STRING,
            cnpj: Sequelize.STRING,
            telefone: Sequelize.STRING,
            email: Sequelize.JSONB
        }, {
            sequelize,
            tableName: 'operadoras'
        });
        return this;
    }

    static associate(models) {
        // Uma Operadora pertence a muitos Usuários
        this.belongsToMany(models.User, {
            through: 'user_operadoras',
            foreignKey: 'operadora_id',
            as: 'users',
        });
    }
}



export default Operadora;